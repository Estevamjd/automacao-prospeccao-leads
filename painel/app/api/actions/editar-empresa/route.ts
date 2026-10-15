import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { chamarFuncao } from '@/lib/funcoes';
export const maxDuration = 120;
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({error:'Origem inválida.'},{status:403});
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({error:'Faça login.'},{status:401});
  const b = await request.json().catch(()=>null);
  if (!b || typeof b.company_id !== 'string' || typeof b.updated_at !== 'string' || !b.dados || typeof b.dados !== 'object' || Array.isArray(b.dados)) return NextResponse.json({error:'Confira os dados.'},{status:400});
  for (const [campo,valor] of Object.entries(b.dados)) {
    if (!['main_phone','main_email','website_url','instagram_url','address_line'].includes(campo) || (valor !== null && typeof valor !== 'string')) return NextResponse.json({error:'Campo inválido.'},{status:400});
    if (['website_url','instagram_url'].includes(campo) && valor) {
      try { const url = new URL(String(valor)); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { return NextResponse.json({error:'Informe um link http ou https válido, sem credenciais.'},{status:400}); }
    }
  }
  const { data: workspace, error } = await supabase.rpc('salvar_dados_empresa',{p_company:b.company_id,p_updated_at:b.updated_at,p_dados:b.dados});
  if (error) return NextResponse.json({error:error.message},{status:400});
  let mensagem = 'Dados confirmados e salvos. A análise será renovada pela fila quando aplicável.';
  try {
    const r = await chamarFuncao<{falhas:number;conflitos:number}>('sync-memory',{workspace_id:workspace,company_id:b.company_id,incluir_campanha:false},60000);
    mensagem += r.falhas || r.conflitos ? ' Memória pendente de sincronização.' : ' Nota do Obsidian atualizada.';
  } catch { mensagem += ' Memória pendente; tente novamente na aba Memória.'; }
  return NextResponse.json({mensagem});
}
