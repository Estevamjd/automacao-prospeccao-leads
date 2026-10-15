import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";

/**
 * Registra pedido de não contato (LGPD).
 *
 * Marca a empresa E grava na lista de supressão. As duas coisas, porque só
 * marcar a empresa não basta: a próxima busca reimporta o estabelecimento e
 * você voltaria a abordar quem pediu para não ser abordado.
 */
export async function POST(request: Request) {
  // Pedido vindo de outro site não grava nada (mesma proteção das outras rotas).
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const { company_id, motivo } = await request.json().catch(() => ({}));
  if (!company_id) {
    return NextResponse.json({ error: "company_id é obrigatório." }, { status: 400 });
  }

  // O RLS garante que só dá para marcar empresa do próprio workspace.
  const { data: empresa, error: erroLeitura } = await supabase
    .from("companies")
    .select("id, workspace_id, name, main_phone, main_email, domain, source_ref")
    .eq("id", company_id)
    .single();

  if (erroLeitura || !empresa) {
    return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  }

  const agora = new Date().toISOString();

  const { error: erroUpdate } = await supabase
    .from("companies")
    .update({ opt_out_at: agora, opt_out_reason: motivo ?? "Pediu para não ser contatado", status: "rejected" })
    .eq("id", company_id);

  if (erroUpdate) {
    return NextResponse.json({ error: erroUpdate.message }, { status: 500 });
  }

  const entradas = [];
  if (empresa.main_phone) {
    const digitos = empresa.main_phone.replace(/[^0-9]/g, "").replace(/^0+/, "");
    const normalizado = digitos.length > 11 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
    if (normalizado.length >= 10 && normalizado.length <= 11) {
      entradas.push({ match_type: "phone", match_value: normalizado });
    }
  }
  if (empresa.main_email) entradas.push({ match_type: "email", match_value: empresa.main_email.toLowerCase().trim() });
  if (empresa.domain) entradas.push({ match_type: "domain", match_value: empresa.domain.toLowerCase().trim() });
  if (empresa.source_ref) entradas.push({ match_type: "source_ref", match_value: empresa.source_ref });

  if (entradas.length > 0) {
    await supabase.from("suppression_list").upsert(
      entradas.map((e) => ({
        workspace_id: empresa.workspace_id,
        ...e,
        reason: motivo ?? "Pedido de não contato registrado no painel",
      })),
      { onConflict: "workspace_id,match_type,match_value", ignoreDuplicates: true },
    );
  }

  return NextResponse.json({
    mensagem: `${empresa.name} não será mais abordada, nem se aparecer de novo numa busca futura.`,
    registros_de_supressao: entradas.length,
  });
}
