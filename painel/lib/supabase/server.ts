import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Formato que o @supabase/ssr entrega em setAll. */
type CookieParaGravar = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};


/**
 * Client do Supabase no servidor, no contexto do usuario logado.
 * Toda consulta feita por aqui passa pelo RLS - e por isso que o painel nao
 * precisa mais carregar a chave de administrador para ler dados.
 */
export async function criarClienteServidor() {
  // No Next 15 cookies() é assíncrono.
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet: CookieParaGravar[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as never),
            );
          } catch {
            // Server Component nao pode escrever cookie; o middleware ja
            // renova a sessao. Ignorar aqui e o comportamento recomendado.
          }
        },
      },
    },
  );
}
