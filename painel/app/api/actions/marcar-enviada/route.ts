import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * Registra que uma mensagem foi enviada — ou desfaz esse registro.
 *
 * Esta rota não existia, e a falta dela travava o projeto: o sistema escrevia
 * mensagens e não havia caminho para dizer "essa eu mandei". Sem isso sent_at
 * ficava nulo para sempre, a empresa nunca saía de ready_for_outreach, o
 * retorno nunca era agendado e a visão de desempenho media o vazio.
 *
 * Todo o trabalho está em marcar_mensagem_enviada, no banco, numa transação
 * só. A primeira versão desta rota fazia três UPDATEs separados e engolia
 * parte dos erros: meia atualização deixa o funil mentindo — mensagem enviada
 * sem retorno agendado, ou empresa em conversa sem mensagem enviada.
 *
 * A função roda como o usuário (SECURITY INVOKER), então o RLS decide o que
 * ele alcança. Nenhum privilégio é emprestado aqui.
 */
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }

  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

  const b = await request.json().catch(() => null);
  if (!b || typeof b.message_id !== 'string' || (b.desfazer !== undefined && typeof b.desfazer !== 'boolean')) {
    return NextResponse.json({ error: 'Confira os dados informados.' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('marcar_mensagem_enviada', {
    p_message: b.message_id,
    p_desfazer: b.desfazer === true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const resultado = (data ?? {}) as { mensagem?: string; alterou?: boolean };
  return NextResponse.json({
    mensagem: resultado.mensagem ?? 'Pronto.',
    alterou: resultado.alterou ?? false,
  });
}
