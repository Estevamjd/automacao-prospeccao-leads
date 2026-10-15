/**
 * Ambiente e autenticacao das Edge Functions.
 *
 * Mudanca em relacao a versao anterior (achado B2 da auditoria): a verificacao
 * do segredo NAO falha mais aberta. Antes, se N8N_WEBHOOK_SECRET nao estivesse
 * configurado, verifyWebhookSecret devolvia true e qualquer um podia chamar as
 * funcoes - inclusive a que gasta credito de OpenAI/Anthropic.
 */

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

export function getSupabaseSecretKey(): string {
  const singleSecret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (singleSecret) return singleSecret;

  const modernSecrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernSecrets) {
    try {
      const parsed = JSON.parse(modernSecrets) as Record<string, unknown>;
      if (typeof parsed.default === "string") return parsed.default;
    } catch {
      if (modernSecrets.startsWith("sb_secret_") || modernSecrets.startsWith("eyJ")) {
        return modernSecrets;
      }
    }
  }

  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/**
 * Comparacao em tempo constante.
 * Comparar segredo com === vaza informacao pelo tempo de resposta: o
 * comparador para no primeiro byte diferente, entao da para descobrir o
 * segredo caractere por caractere. Em funcao publica isso importa.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);

  // Compara o comprimento tambem em tempo constante: o XOR acumulado comeca
  // diferente de zero quando os tamanhos nao batem.
  let diferenca = bytesA.length ^ bytesB.length;
  const tamanho = Math.max(bytesA.length, bytesB.length);

  for (let i = 0; i < tamanho; i += 1) {
    diferenca |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }

  return diferenca === 0;
}

export type ResultadoAuth =
  | { ok: true }
  | { ok: false; status: number; erro: string };

/**
 * Autentica chamada maquina-a-maquina (n8n, painel) pelo segredo compartilhado.
 *
 * Falha FECHADA: sem segredo configurado no ambiente, a funcao recusa tudo e
 * avisa no log. E melhor a automacao parar e voce descobrir na hora do que ela
 * funcionar aberta para a internet inteira sem ninguem perceber.
 */
export function verifyWebhookSecret(req: Request): ResultadoAuth {
  const esperado = Deno.env.get("N8N_WEBHOOK_SECRET");

  if (!esperado || esperado.trim().length < 16) {
    console.error(
      "[seguranca] N8N_WEBHOOK_SECRET ausente ou curto demais (mínimo 16 caracteres). " +
      "A função está recusando todas as chamadas de propósito. " +
      "Configure com: supabase secrets set N8N_WEBHOOK_SECRET=<valor forte>",
    );
    return {
      ok: false,
      status: 500,
      erro: "Função mal configurada: segredo de webhook ausente no servidor.",
    };
  }

  const recebido = req.headers.get("x-webhook-secret");
  if (!recebido) {
    return { ok: false, status: 401, erro: "Cabeçalho x-webhook-secret ausente." };
  }

  if (!timingSafeEqual(recebido, esperado)) {
    return { ok: false, status: 401, erro: "Segredo de webhook inválido." };
  }

  return { ok: true };
}

/** Lista de origens autorizadas a chamar do navegador. */
export function allowedOrigins(): string[] {
  const bruto = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  return bruto
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
