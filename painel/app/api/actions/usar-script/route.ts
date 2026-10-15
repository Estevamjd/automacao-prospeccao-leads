import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !UUID.test(body.message_id ?? '') || !UUID.test(body.template_id ?? '')) {
    return NextResponse.json({ error: 'Rascunho ou roteiro inválido.' }, { status: 400 });
  }
  const [mensagem, roteiro] = await Promise.all([
    supabase.from('outreach_messages').select('workspace_id,channel,status,sent_at')
      .eq('id', body.message_id).single(),
    supabase.from('message_templates').select('workspace_id,channel,etapa,is_active')
      .eq('id', body.template_id).single(),
  ]);
  if (mensagem.error || roteiro.error || !mensagem.data || !roteiro.data ||
      mensagem.data.workspace_id !== roteiro.data.workspace_id ||
      mensagem.data.channel !== roteiro.data.channel ||
      mensagem.data.status !== 'draft' || mensagem.data.sent_at ||
      roteiro.data.etapa !== 'primeiro_contato' || !roteiro.data.is_active) {
    return NextResponse.json({ error: 'Roteiro indisponível para este rascunho.' }, { status: 400 });
  }
  const { error } = await supabase.rpc('usar_script', {
    p_message: body.message_id, p_template: body.template_id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ mensagem: 'Roteiro associado ao rascunho.' });
}
