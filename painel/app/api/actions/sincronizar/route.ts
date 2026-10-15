import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { chamarFuncao } from '@/lib/funcoes';
export const maxDuration = 300;
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });
  const { data: w } = await supabase.from('workspaces').select('id').limit(1).maybeSingle();
  if (!w) return NextResponse.json({ error: 'Espaço não encontrado.' }, { status: 404 });
  try {
    const r = await chamarFuncao<{ criadas: number; atualizadas: number; inalteradas: number; falhas: number; conflitos: number }>('sync-memory', { workspace_id: w.id });
    return NextResponse.json({ mensagem: `${r.criadas} criadas, ${r.atualizadas} atualizadas, ${r.inalteradas} sem mudanças. ${r.falhas} falhas e ${r.conflitos} conflitos.` });
  } catch { return NextResponse.json({ error: 'Não foi possível sincronizar agora. Seus registros continuam salvos.' }, { status: 502 }); }
}
