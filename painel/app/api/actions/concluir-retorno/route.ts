import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  if (typeof b.id !== 'string') return NextResponse.json({ error: 'Retorno inválido.' }, { status: 400 });
  const { error } = await supabase.rpc('concluir_retorno', { p_id: b.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ mensagem: 'Retorno concluído e registrado no histórico.' });
}
