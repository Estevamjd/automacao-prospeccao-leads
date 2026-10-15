import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * "Testar WhatsApp no fixo" (29/09): o Estevam abriu wa.me com o fixo e viu
 * se a conversa abre. Aqui ele confirma. Quem decide o canal, cancela o
 * roteiro de ligação e põe a análise de volta na fila é o banco
 * (confirmar_whatsapp); esta rota só confere o formato.
 */
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

  const b = await request.json().catch(() => null);
  if (!b || typeof b.company_id !== 'string' || typeof b.tem !== 'boolean'
      || (b.telefone != null && (typeof b.telefone !== 'string' || !/^[\d +().-]{10,20}$/.test(b.telefone)))) {
    return NextResponse.json({ error: 'Confira os dados informados.' }, { status: 400 });
  }
  // Desde 30/09 o teste vale por número; sem telefone, vale para o principal.
  const { data, error } = await supabase.rpc('confirmar_whatsapp', { p_company: b.company_id, p_tem: b.tem, p_telefone: b.telefone ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const r = (data ?? {}) as { canal?: string; mensagem_refeita?: boolean; principal_trocado?: boolean; principal_conferido?: boolean };
  const mensagem = !b.tem
    ? 'Anotado: esse número não tem WhatsApp.'
    : r.principal_trocado
      ? 'WhatsApp confirmado. Esse número virou o principal e a mensagem vai ser reescrita para ele.'
      : r.principal_conferido
        ? 'WhatsApp confirmado. O principal continua o que você conferiu à mão; use "Usar este" se quiser mandar para este número.'
        : r.mensagem_refeita
          ? 'WhatsApp confirmado. A mensagem vai ser reescrita para o WhatsApp.'
          : 'WhatsApp confirmado.';
  return NextResponse.json({ mensagem, canal: r.canal ?? null, refazer: !!r.mensagem_refeita });
}
