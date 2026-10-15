import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * "Número errado" (01/10): o WhatsApp abriu com o nome de outra pessoa (o
 * celular antigo pode ter mudado de dono). O banco (descartar_telefone) tira
 * o número da empresa, põe na lista de não contatar, troca o principal se
 * precisar e refaz a mensagem.
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
  const { data, error } = await supabase.rpc('descartar_telefone', { p_company: b.company_id, p_telefone: b.telefone });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const r = (data ?? {}) as { principal?: string | null; mensagem_refeita?: boolean; restantes?: number };
  const mensagem = r.restantes
    ? `Número descartado e protegido na lista de não contatar.${r.mensagem_refeita ? ' A mensagem vai ser reescrita para o próximo número.' : ''}`
    : 'Número descartado e protegido na lista de não contatar. A empresa ficou sem telefone: use "Achar WhatsApp" na ficha.';
  return NextResponse.json({ mensagem, refazer: !!r.mensagem_refeita });
}
