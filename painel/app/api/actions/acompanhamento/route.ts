import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { chamarFuncao } from '@/lib/funcoes';
import { ETAPAS } from '@/lib/comercial';
export const maxDuration = 120;
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b || typeof b.status !== 'string' || !(b.status in ETAPAS) || typeof b.company_id !== 'string' || !b.updated_at || (b.valor !== null && (typeof b.valor !== 'number' || !Number.isFinite(b.valor) || b.valor < 0))) return NextResponse.json({ error: 'Confira os dados informados.' }, { status: 400 });
  const { data: workspace, error } = await supabase.rpc('salvar_acompanhamento_v2', {
    p_company: b.company_id, p_updated_at: b.updated_at, p_status: b.status,
    p_nota: b.nota ?? '', p_valor: b.valor, p_data: b.data || null,
    p_servico: b.servico ?? '', p_retorno: b.retorno || null,
    p_motivo: typeof b.motivo === 'string' ? b.motivo : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  let memoria = 'Sincronizado com o Obsidian.';
  try {
    const resultado = await chamarFuncao<{ falhas: number; conflitos: number }>('sync-memory', { workspace_id: workspace, company_id: b.company_id, incluir_campanha: false }, 60000);
    if (resultado.falhas || resultado.conflitos) memoria = 'Registro salvo; a memória precisa de uma nova sincronização.';
  } catch { memoria = 'Registro salvo. Obsidian pendente; tente sincronizar na aba Memória.'; }
  return NextResponse.json({ mensagem: `Acompanhamento salvo. ${memoria}` });
}
