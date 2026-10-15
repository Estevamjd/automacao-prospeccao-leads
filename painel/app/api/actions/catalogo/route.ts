import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z][a-z0-9_]{1,39}$/;
const CNAE = /^\d{7}$/;
const OSM = /^[a-z0-9:_-]{1,40}$/;
const OSM_VALOR = /^[a-z0-9:_ -]{1,60}$/;

function textos(valor: unknown, limite: number, tamanho: number, padrao?: RegExp): string[] | null {
  if (!Array.isArray(valor) || valor.length > limite) return null;
  const lista = valor.map(v => typeof v === 'string' ? v.trim() : '');
  if (lista.some(v => !v || v.length > tamanho || (padrao && !padrao.test(v)))) return null;
  return [...new Set(lista)];
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });
  const { data: workspace } = await supabase.from('workspaces').select('id,owner_id').limit(1).maybeSingle();
  if (!workspace || workspace.owner_id !== user.id) return NextResponse.json({ error: 'Só o dono pode editar o catálogo.' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object' || !SLUG.test(b.slug ?? '') || typeof b.label !== 'string' ||
      !b.label.trim() || b.label.length > 80 || typeof b.is_active !== 'boolean' ||
      (b.id && !UUID.test(b.id))) {
    return NextResponse.json({ error: 'Confira o identificador, nome e status do nicho.' }, { status: 400 });
  }
  const cnaes_principais = textos(b.cnaes_principais, 100, 7, CNAE);
  const cnaes_com_palavra = textos(b.cnaes_com_palavra, 100, 7, CNAE);
  const cnaes_secundarios = textos(b.cnaes_secundarios, 100, 7, CNAE);
  const google_types = textos(b.google_types, 60, 80, /^[a-z][a-z0-9_]*$/);
  const palavras_nome = textos(b.palavras_nome, 100, 80);
  const palavras_excluir = textos(b.palavras_excluir, 100, 80);
  const opening_questions = textos(b.opening_questions, 20, 300);
  const avoid = textos(b.avoid, 20, 300);
  if ([cnaes_principais, cnaes_com_palavra, cnaes_secundarios, google_types, palavras_nome, palavras_excluir, opening_questions, avoid].some(v => v === null)) {
    return NextResponse.json({ error: 'Confira as listas de CNAE, palavras e perguntas.' }, { status: 400 });
  }
  if (!Array.isArray(b.osm_tags) || b.osm_tags.length > 20 || b.osm_tags.some((t: unknown) => {
    const tag = t as { chave?: unknown; valores?: unknown };
    return !tag || typeof tag.chave !== 'string' || !OSM.test(tag.chave) ||
      textos(tag.valores, 20, 60, OSM_VALOR) === null || !Array.isArray(tag.valores) || !tag.valores.length;
  })) return NextResponse.json({ error: 'Confira as tags do OpenStreetMap.' }, { status: 400 });
  if (!Array.isArray(b.offers) || b.offers.length > 20 || b.offers.some((o: unknown) => {
    const oferta = o as Record<string, unknown>;
    return !oferta || !SLUG.test(oferta.codigo as string) ||
      !['titulo','porque','pitch'].every(k => typeof oferta[k] === 'string' && !!(oferta[k] as string).trim() && (oferta[k] as string).length <= 300) ||
      !['baixo','medio','alto'].includes(oferta.esforco as string) || !['baixo','medio','alto'].includes(oferta.impacto as string);
  })) return NextResponse.json({ error: 'Confira o código, texto, esforço e impacto das ofertas.' }, { status: 400 });
  if (b.is_active && (!b.offers.length || !opening_questions?.length || !(cnaes_principais?.length || cnaes_com_palavra?.length || b.osm_tags.length))) {
    return NextResponse.json({ error: 'Para ativar, preencha ao menos uma oferta, pergunta e fonte (CNAE ou mapa).' }, { status: 400 });
  }
  if (typeof b.apresentacao !== 'string' || b.apresentacao.length > 200) {
    return NextResponse.json({ error: 'Apresentação muito longa.' }, { status: 400 });
  }

  const campos = { label: b.label.trim(), apresentacao: b.apresentacao.trim() || null,
    cnaes_principais, cnaes_com_palavra, cnaes_secundarios, google_types,
    osm_tags: b.osm_tags.map((t: { chave: string; valores: string[] }) => ({ chave: t.chave, valores: [...new Set(t.valores)] })),
    palavras_nome, palavras_excluir, opening_questions, avoid, is_active: b.is_active,
  };
  let existente: { slug: string; offers: Array<Record<string, unknown>> } | null = null;
  if (b.id) {
    const r = await supabase.from('niche_playbooks').select('slug,offers').eq('id', b.id).eq('workspace_id', workspace.id).maybeSingle();
    if (r.error || !r.data || r.data.slug !== b.slug) return NextResponse.json({ error: 'Nicho não encontrado ou identificador alterado.' }, { status: 404 });
    existente = r.data as { slug: string; offers: Array<Record<string, unknown>> };
  }
  const offers = b.offers.map((o: Record<string, unknown>, i: number) => ({ ...(existente?.offers?.[i] ?? {}),
    codigo: o.codigo, titulo: (o.titulo as string).trim(), porque: (o.porque as string).trim(),
    pitch: (o.pitch as string).trim(), esforco: o.esforco, impacto: o.impacto,
    faixa_preco: typeof o.faixa_preco === 'string' ? o.faixa_preco.slice(0, 80) : null }));
  const consulta = b.id
    ? supabase.from('niche_playbooks').update({ ...campos, offers }).eq('id', b.id).eq('workspace_id', workspace.id)
    : supabase.from('niche_playbooks').insert({ ...campos, offers, slug: b.slug, workspace_id: workspace.id });
  const { data, error } = await consulta.select('id,slug,label,icone,ordem,is_active,apresentacao,cnaes_principais,cnaes_com_palavra,cnaes_secundarios,google_types,osm_tags,palavras_nome,palavras_excluir,opening_questions,avoid,pains,offers').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ nicho: data });
}
