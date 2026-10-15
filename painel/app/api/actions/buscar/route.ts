import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { buscarNoMapa, filtrosDoCatalogo, type LeadMapa } from '@/lib/overpass';
import { zonasDe } from '@/lib/geografia';

/**
 * Busca unificada (v2, 29/09/2026): cadastro de CNPJ + mapa, sem escolher fonte.
 *
 * 1. Cadastro de CNPJ (reserva no banco): trazer_do_cnpj traz as N melhores
 *    (celular primeiro) e já junta com o que existir na base.
 * 2. Mapa (OpenStreetMap): só lugares com algum contato. ingerir_do_mapa usa
 *    a MESMA junção (mesclar_empresa): se a empresa já veio do CNPJ, o mapa
 *    completa (site, Instagram, WhatsApp, horário) em vez de duplicar.
 * Quem decide duplicata, "não contatar" e canal é o banco, não esta rota.
 * Se o mapa falhar, a busca não falha: volta o que o cadastro trouxe e um aviso.
 */
export const maxDuration = 300;

const UF_VALIDA = /^(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)$/;
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

type ResCnpj = { novas: number; completadas: number; suprimidas: number; ja_estavam: number; restantes: number };
type ResMapa = { novas: number; completadas: number; suprimidas: number; sem_contato: number; ja_estavam: number };
const NICHOS_LEGADOS = new Set(['academia', 'bar', 'educacao', 'mercado', 'odonto']);

/** WhatsApp/celular primeiro, depois telefone, depois só e-mail/site/Instagram. */
function prioridade(l: LeadMapa) {
  const celular = l.telefones.some(t => /^\d{2}9\d{8}$/.test(t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')));
  if (l.signals.has_whatsapp || celular) return 0;
  if (l.telefones.length) return 1;
  return 2;
}

export async function POST(request: Request) {
  // Pedido vindo de outro site não grava nada.
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login para buscar.' }, { status: 401 });

  const b = await request.json().catch(() => null);
  const uf = typeof b?.uf === 'string' && UF_VALIDA.test(b.uf) ? b.uf : null;
  const nicho = texto(b?.nicho, 40);
  const municipio = texto(b?.municipio, 80);
  const zonas = uf ? zonasDe(uf, municipio) : null;
  const zona = typeof b?.zona === 'string' && zonas && b.zona in zonas ? b.zona : null;
  const bairros = Array.isArray(b?.bairros)
    ? (b.bairros as unknown[]).map(x => texto(x, 60)).filter((x): x is string => !!x).slice(0, 30)
    : [];
  const quantidade = Math.min(Math.max(Math.floor(Number(b?.quantidade) || 20), 1), 50);
  const cep = typeof b?.cep === 'string' ? b.cep.replace(/\D/g, '') : '';
  if (!uf || !nicho) return NextResponse.json({ error: 'Escolha o estado e o nicho.' }, { status: 400 });
  if (cep && !/^\d{2,8}$/.test(cep)) return NextResponse.json({ error: 'CEP inválido.' }, { status: 400 });
  if (cep && NICHOS_LEGADOS.has(nicho)) return NextResponse.json({ error: 'Este nicho ainda não aceita filtro por CEP. Use cidade e bairro.' }, { status: 400 });
  if (bairros.length && !municipio) return NextResponse.json({ error: 'Para escolher bairros, escolha a cidade.' }, { status: 400 });

  // O workspace vem da sessão, nunca do corpo do pedido (achado B1).
  const { data: workspace } = await supabase.from('workspaces').select('id').limit(1).maybeSingle();
  if (!workspace) return NextResponse.json({ error: 'Sua conta ainda não está ligada a nenhum espaço de trabalho.' }, { status: 404 });
  const { data: nichoAtivo } = await supabase.from('niche_playbooks').select('label,osm_tags')
    .eq('workspace_id', workspace.id).eq('slug', nicho).eq('is_active', true).maybeSingle();
  if (!nichoAtivo) return NextResponse.json({ error: 'Nicho não encontrado no catálogo.' }, { status: 400 });

  // 1. Cadastro de CNPJ
  const cnpj = NICHOS_LEGADOS.has(nicho)
    ? await supabase.rpc('trazer_do_cnpj', {
        p_workspace: workspace.id, p_segmento: nicho, p_uf: uf, p_municipio: municipio,
        p_zona: zona, p_bairros: bairros.length ? bairros : null, p_limite: quantidade,
      })
    : await supabase.rpc('trazer_do_cnpj_v3', {
        p_workspace: workspace.id, p_nicho: nicho, p_uf: uf, p_municipio: municipio,
        p_zona: zona, p_bairros: bairros.length ? bairros : null, p_cep: cep || null,
        p_limite: quantidade, p_filtros: {},
      });
  if (cnpj.error) return NextResponse.json({ error: cnpj.error.message }, { status: 400 });
  const rc = cnpj.data as ResCnpj;

  // 2. Mapa
  const rm: ResMapa = { novas: 0, completadas: 0, suprimidas: 0, sem_contato: 0, ja_estavam: 0 };
  let avisoMapa = '';
  let noMapa = 0;
  if (!cep) try {
    const { leads } = await buscarNoMapa({ uf, municipio, zona, bairros }, nicho, 400, filtrosDoCatalogo(nichoAtivo.osm_tags));
    noMapa = leads.length;
    // Quem já está na base não precisa ir de novo (o banco resolveria, mas
    // mandaria sempre os mesmos primeiros e nunca chegaria aos outros).
    const refs = leads.map(l => l.source_ref);
    const conhecidos = new Set<string>();
    for (let i = 0; i < refs.length; i += 200) {
      const { data } = await supabase.from('companies').select('source_ref')
        .eq('workspace_id', workspace.id).in('source_ref', refs.slice(i, i + 200));
      for (const c of data ?? []) conhecidos.add(c.source_ref as string);
    }
    rm.ja_estavam = conhecidos.size;
    const fila = leads.filter(l => !conhecidos.has(l.source_ref))
      .sort((a, c) => prioridade(a) - prioridade(c))
      .slice(0, Math.min(quantidade * 2, 100));
    for (let i = 0; i < fila.length; i += 100) {
      const descricao = [nichoAtivo.label, zona ? `${municipio} (${zonas?.[zona]})` : municipio ?? uf, bairros.join(', ')]
        .filter(Boolean).join(' · ').slice(0, 150);
      const { data, error } = await supabase.rpc('ingerir_do_mapa', {
        p_workspace: workspace.id, p_leads: fila.slice(i, i + 100), p_descricao: descricao,
      });
      if (error) throw new Error(error.message);
      const r = data as ResMapa;
      for (const k of Object.keys(rm) as (keyof ResMapa)[]) rm[k] += r[k] ?? 0;
    }
  } catch (erro) {
    avisoMapa = erro instanceof Error ? erro.message : 'O mapa não respondeu agora.';
  }

  const novas = (rc.novas ?? 0) + rm.novas;
  const completadas = (rc.completadas ?? 0) + rm.completadas;
  const partes = [`${novas} ${novas === 1 ? 'empresa nova' : 'empresas novas'}`];
  if (completadas) partes.push(`${completadas} ${completadas === 1 ? 'completada' : 'completadas'} com dados da outra fonte`);
  const suprimidas = (rc.suprimidas ?? 0) + rm.suprimidas;
  if (suprimidas) partes.push(`${suprimidas} na lista de não contatar (puladas)`);
  let mensagem = `${partes.join(', ')}.`;
  if (rc.restantes > 0) mensagem += ` Ainda há ${rc.restantes} no cadastro com esse filtro.`;
  if (cep) mensagem += ' O mapa não foi consultado porque não filtra CEP com precisão.';
  if (avisoMapa) mensagem += ` Mapa: ${avisoMapa} Tente de novo depois para completar.`;

  return NextResponse.json({
    mensagem, novas, completadas, suprimidas,
    cnpj: rc, mapa: { ...rm, encontrados: noMapa, erro: avisoMapa || null },
  });
}
