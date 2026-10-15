import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Formato que o @supabase/ssr entrega em setAll. */
type CookieParaGravar = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};


/**
 * Correcao do achado B3 da auditoria: o painel anterior nao tinha login
 * nenhum. Nao havia middleware, nem sessao, nem tela de entrada - e as rotas
 * /api/actions/* aceitavam POST de qualquer origem, com a chave de
 * administrador carregada no servidor.
 *
 * Este middleware roda ANTES de qualquer rota: sem sessao valida, nada passa.
 */

const ROTAS_PUBLICAS = ["/login", "/auth/callback", "/auth/erro"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: CookieParaGravar[]) => {
          cookiesToSet.forEach(({ name, value }: CookieParaGravar) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: CookieParaGravar) =>
            response.cookies.set(name, value, options as never),
          );
        },
      },
    },
  );

  // getUser() valida o token no servidor do Supabase.
  // getSession() apenas le o cookie e NAO serve para autorizar.
  const { data: { user } } = await supabase.auth.getUser();

  const caminho = request.nextUrl.pathname;
  const ehPublica = ROTAS_PUBLICAS.some((r) => caminho.startsWith(r));

  if (!user && !ehPublica) {
    // Rota de API responde 401 em JSON; página redireciona para o login.
    if (caminho.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Faça login para usar o painel." },
        { status: 401 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("proximo", caminho);
    return NextResponse.redirect(url);
  }

  if (user && caminho === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
