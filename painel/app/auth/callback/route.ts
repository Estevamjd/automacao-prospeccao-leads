import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const proximo = searchParams.get("proximo") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/erro?motivo=sem-codigo`);
  }

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/auth/erro?motivo=${encodeURIComponent(error.message)}`);
  }

  // Só aceita caminho interno: evita redirecionamento aberto para site externo.
  const destino = proximo.startsWith("/") && !proximo.startsWith("//") ? proximo : "/";
  return NextResponse.redirect(`${origin}${destino}`);
}
