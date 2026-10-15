import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseSecretKey, requireEnv } from "./env.ts";
import { HttpError } from "./http.ts";

/** Client administrativo: ignora RLS. Usar SOMENTE em rota autenticada por segredo. */
export function createAdminClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), getSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client no contexto do usuario que chamou: o RLS continua valendo.
 *
 * Esta e a correcao do achado B1. A funcao dashboard-data usava o client
 * administrativo e aceitava workspace_id do corpo da requisicao, entao qualquer
 * usuario logado lia o workspace de qualquer outro. Com o token do usuario, o
 * proprio banco filtra - nao ha como pedir dado alheio.
 */
export function createUserClient(req: Request): SupabaseClient {
  const authorization = req.headers.get("Authorization") ?? "";

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "Faça login para acessar estes dados.");
  }

  const token = authorization.slice(7).trim();
  if (!token) {
    throw new HttpError(401, "Token de acesso ausente.");
  }

  return createClient(
    requireEnv("SUPABASE_URL"),
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? requireEnv("SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/** Confirma que ha um usuario real por tras do token. */
export async function exigirUsuario(client: SupabaseClient): Promise<{ id: string; email?: string }> {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    throw new HttpError(401, "Sessão inválida ou expirada. Faça login novamente.");
  }
  return { id: data.user.id, email: data.user.email ?? undefined };
}
