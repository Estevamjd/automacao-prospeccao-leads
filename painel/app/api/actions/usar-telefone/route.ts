import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * "Usar este" (30/09): troca o telefone principal por outro número que as
 * fontes já trouxeram para a empresa. O banco (usar_telefone) só aceita
 * número conhecido da empresa, registra no histórico e refaz a mensagem se
 * ainda não houve contato.
 */
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

  const b = await request.json().catch(() => null);
  if (!b || typeof b.company_id !== 'string' || typeof b.telefone !== 'string' || !/^[\d +().-]{10,20}$/.test(b.telefone)) {
    return NextResponse.json({ error: 'Confira o número.' }, { status: 400 });
  }
  const { data, error } = await supabase.rpc('usar_telefone', { p_company: b.company_id, p_telefone: b.telefone });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const r = (data ?? {}) as { mensagem_refeita?: boolean };
  return NextResponse.json({
    mensagem: r.mensagem_refeita ? 'Número principal trocado. A mensagem vai ser reescrita para ele.' : 'Número principal trocado.',
    refazer: !!r.mensagem_refeita,
  });
}
