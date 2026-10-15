import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { chamarFuncao } from '@/lib/funcoes';

export const maxDuration = 120;

/**
 * Propostas (I6 fase 1). Duas acoes:
 *   { acao: 'registrar', company_id, servico, valor?, enviada_em?, validade?, observacao? }
 *   { acao: 'decidir', proposta_id, decisao: 'aprovada'|'recusada'|'expirada', motivo?, data? }
 *
 * As regras (motivo obrigatorio, etapa da empresa, soma dos contratos) vivem
 * no banco: registrar_proposta e decidir_proposta. Aqui so conferimos o
 * formato e sincronizamos a nota da empresa no Obsidian.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v: unknown, max: number) => typeof v === 'string' && v.trim().length <= max ? v.trim() : null;
const dataOpcional = (v: unknown) => (typeof v === 'string' && DATA.test(v) ? v : null);

export async function POST(request: Request) {
  // Mesmo bloqueio das outras acoes: pedido vindo de outro site nao grava nada.
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return NextResponse.json({ error: 'Confira os dados informados.' }, { status: 400 });

  let companyId: string;
  let mensagem: string;

  if (b.acao === 'registrar') {
    const servico = texto(b.servico, 300);
    const valorOk = b.valor === null || b.valor === undefined || (typeof b.valor === 'number' && Number.isFinite(b.valor) && b.valor >= 0 && b.valor <= 999999999);
    if (typeof b.company_id !== 'string' || !UUID.test(b.company_id) || !servico || !valorOk) {
      return NextResponse.json({ error: 'Informe o serviço e confira o valor.' }, { status: 400 });
    }
    const { error } = await supabase.rpc('registrar_proposta', {
      p_company: b.company_id, p_servico: servico, p_valor: b.valor ?? null,
      p_enviada_em: dataOpcional(b.enviada_em), p_validade: dataOpcional(b.validade),
      p_observacao: texto(b.observacao, 2000),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    companyId = b.company_id;
    mensagem = 'Proposta registrada.';
  } else if (b.acao === 'decidir') {
    if (typeof b.proposta_id !== 'string' || !UUID.test(b.proposta_id) || !['aprovada', 'recusada', 'expirada'].includes(b.decisao)) {
      return NextResponse.json({ error: 'Confira os dados informados.' }, { status: 400 });
    }
    const { data: proposta } = await supabase.from('propostas').select('company_id').eq('id', b.proposta_id).maybeSingle();
    if (!proposta) return NextResponse.json({ error: 'Proposta não encontrada.' }, { status: 404 });
    const { error } = await supabase.rpc('decidir_proposta', {
      p_proposta: b.proposta_id, p_decisao: b.decisao,
      p_motivo: texto(b.motivo, 200), p_data: dataOpcional(b.data),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    companyId = proposta.company_id;
    mensagem = { aprovada: 'Proposta aprovada: contrato fechado.', recusada: 'Recusa registrada.', expirada: 'Proposta marcada como sem resposta.' }[b.decisao as string]!;
  } else {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  }

  // O registro ja esta salvo; a sincronizacao do Obsidian e melhor esforco.
  let memoria = 'Sincronizado com o Obsidian.';
  try {
    const { data: empresa } = await supabase.from('companies').select('workspace_id').eq('id', companyId).maybeSingle();
    const resultado = await chamarFuncao<{ falhas: number; conflitos: number }>('sync-memory', { workspace_id: empresa?.workspace_id, company_id: companyId, incluir_campanha: false }, 60000);
    if (resultado.falhas || resultado.conflitos) memoria = 'A memória precisa de uma nova sincronização.';
  } catch { memoria = 'Obsidian pendente; tente sincronizar na aba Memória.'; }
  return NextResponse.json({ mensagem: `${mensagem} ${memoria}` });
}
