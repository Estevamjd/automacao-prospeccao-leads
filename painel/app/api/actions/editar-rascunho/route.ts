import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * Salva a mensagem personalizada ("O que você viu", 29/09). O banco
 * (editar_rascunho) garante: só rascunho não enviado, tamanho 10 a 4.000,
 * rodapé de saída sempre presente, e guarda o que foi observado na empresa.
 */
const ONDE = ['google', 'maps', 'instagram', 'ifood', 'regiao'];
const ESTILOS = ['pesquisa', 'elogio', 'cliente', 'vizinho', 'curta'];

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Faça login.' }, { status: 401 });

  const b = await request.json().catch(() => null);
  if (!b || typeof b.message_id !== 'string' || typeof b.body !== 'string' || b.body.length > 4000) {
    return NextResponse.json({ error: 'Confira a mensagem.' }, { status: 400 });
  }
  // Observações: só os campos conhecidos, curtos. Nada de objeto livre do navegador.
  let observacoes: Record<string, string | number> | null = null;
  const v = b.viu;
  if (v && typeof v === 'object') {
    observacoes = {};
    if (typeof v.onde === 'string' && ONDE.includes(v.onde)) observacoes.onde = v.onde;
    const nota = Number(String(v.nota ?? '').replace(',', '.'));
    if (Number.isFinite(nota) && nota >= 1 && nota <= 5) observacoes.nota_google = Math.round(nota * 10) / 10;
    if (typeof v.observacao === 'string' && /^[a-z_]{1,20}$/.test(v.observacao)) observacoes.observacao = v.observacao;
    if (typeof v.outra === 'string' && v.outra.trim()) observacoes.texto = v.outra.trim().slice(0, 300);
    // Jeito de abrir (30/09): guardado para comparar depois qual estilo tem mais resposta.
    if (typeof v.estilo === 'string' && ESTILOS.includes(v.estilo)) observacoes.estilo = v.estilo;
    if (v.estilo === 'cliente' && v.aconteceu === true) observacoes.cliente_confirmado = 'sim';
    if (!Object.keys(observacoes).length) observacoes = null;
  }

  const { error } = await supabase.rpc('editar_rascunho', { p_message: b.message_id, p_body: b.body, p_observacoes: observacoes });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ mensagem: 'Mensagem salva.' });
}
