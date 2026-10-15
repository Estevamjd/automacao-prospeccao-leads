/**
 * Casca HTTP comum a todas as Edge Functions.
 *
 * Resolve os achados B4 (CORS aberto para qualquer origem) e G7 (excecao nao
 * tratada devolvia 500 sem cabecalho de CORS e deixava a tarefa presa).
 */

import { allowedOrigins } from "./env.ts";

/**
 * Monta o CORS a partir da origem de quem chamou.
 * Origem desconhecida nao recebe permissao - antes era "*", o que deixava
 * qualquer site na internet chamar funcoes que rodam com chave de admin.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origem = req.headers.get("origin")?.replace(/\/$/, "") ?? "";
  const permitidas = allowedOrigins();

  const base: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  if (origem && permitidas.includes(origem)) {
    base["Access-Control-Allow-Origin"] = origem;
    base["Access-Control-Allow-Credentials"] = "true";
  }

  return base;
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Erro com codigo HTTP proprio, para o handler devolver a mensagem certa. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public detalhe?: unknown) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Envolve o handler: trata OPTIONS, exige POST, captura QUALQUER excecao e
 * devolve JSON com CORS. Nenhuma funcao deve chamar Deno.serve direto.
 */
export function serveJson(
  handler: (req: Request) => Promise<unknown>,
  opcoes: { metodos?: string[] } = {},
): (req: Request) => Promise<Response> {
  const metodos = opcoes.metodos ?? ["POST"];

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    if (!metodos.includes(req.method)) {
      return jsonResponse(req, { error: `Método ${req.method} não permitido.` }, 405);
    }

    try {
      const resultado = await handler(req);
      return jsonResponse(req, resultado ?? { ok: true });
    } catch (erro) {
      if (erro instanceof HttpError) {
        // Erro esperado: devolve a mensagem, sem stack.
        return jsonResponse(req, { error: erro.message, detalhe: erro.detalhe }, erro.status);
      }

      // Erro inesperado: registra tudo no log do servidor, mas devolve
      // mensagem generica. Detalhe de erro interno em resposta publica e
      // material de reconhecimento para quem esta sondando.
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.error("[erro-nao-tratado]", mensagem, erro instanceof Error ? erro.stack : "");

      return jsonResponse(
        req,
        { error: "Erro interno ao processar a requisição.", referencia: crypto.randomUUID() },
        500,
      );
    }
  };
}

/** Le o corpo JSON com limite de tamanho e mensagem de erro util. */
export async function lerJson<T = Record<string, unknown>>(
  req: Request,
  limiteBytes = 1_000_000,
): Promise<T> {
  const tamanho = Number(req.headers.get("content-length") ?? 0);
  if (tamanho > limiteBytes) {
    throw new HttpError(413, `Corpo maior que o limite de ${limiteBytes} bytes.`);
  }

  const texto = await req.text();
  if (texto.length > limiteBytes) {
    throw new HttpError(413, `Corpo maior que o limite de ${limiteBytes} bytes.`);
  }

  if (!texto.trim()) return {} as T;

  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new HttpError(400, "Corpo da requisição não é JSON válido.");
  }
}
