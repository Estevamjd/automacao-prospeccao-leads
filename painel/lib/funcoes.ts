/**
 * Chamadas as Edge Functions do Supabase, sempre do lado do servidor.
 * O segredo de webhook nunca chega ao navegador.
 */

export async function chamarFuncao<T = unknown>(
  nome: string,
  corpo: unknown,
  timeoutMs = 120_000,
): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const segredo = process.env.N8N_WEBHOOK_SECRET;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada.");
  if (!segredo) {
    throw new Error(
      "N8N_WEBHOOK_SECRET não configurada no painel. As funções recusam chamadas sem ela, de propósito.",
    );
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), timeoutMs);

  try {
    const resposta = await fetch(`${url}/functions/v1/${nome}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": segredo,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
      },
      body: JSON.stringify(corpo),
      signal: controle.signal,
      cache: "no-store",
    });

    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(dados?.error ?? `A função ${nome} respondeu ${resposta.status}.`);
    }

    return dados as T;
  } finally {
    clearTimeout(relogio);
  }
}
