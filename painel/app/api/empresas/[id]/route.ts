import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { COLUNAS_EMPRESA } from '@/lib/empresa';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });
  const { id } = await params;
  const [historico, evidencias, empresa, propostas] = await Promise.all([
    supabase.from('activities').select('id,title,body,happened_at,metadata').eq('company_id', id).order('happened_at', { ascending: false }).limit(50),
    supabase.from('evidence_items').select('id,title,source_url,extracted_text,observed_at').eq('company_id', id).order('observed_at', { ascending: false }).limit(20),
    supabase.from('companies').select(COLUNAS_EMPRESA).eq('id',id).maybeSingle(),
    supabase.from('propostas').select('id,servico,valor,status,motivo,observacao,enviada_em,validade,decidida_em').eq('company_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (historico.error || evidencias.error || empresa.error || propostas.error) return NextResponse.json({ error: 'Não foi possível carregar a ficha.' }, { status: 500 });
  if (!empresa.data) return NextResponse.json({error:'Empresa não encontrada.'},{status:404});
  return NextResponse.json({ historico: historico.data, evidencias: evidencias.data, empresa:empresa.data, propostas: propostas.data });
}
