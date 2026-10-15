import { createAdminClient, createUserClient, exigirUsuario } from "../_shared/db.ts";
import { HttpError, lerJson, serveJson } from "../_shared/http.ts";

type Entrada = { action?: unknown; workspace_id?: unknown; email?: unknown; user_id?: unknown };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function encontrarUsuario(admin: ReturnType<typeof createAdminClient>, email: string) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new HttpError(500, "Não foi possível consultar as contas.");
    const achado = data.users.find((user) => user.email?.toLowerCase() === email);
    if (achado) return achado;
    if (data.users.length < 1000) return null;
  }
  throw new HttpError(503, "Há contas demais para localizar este e-mail. Contate o suporte.");
}

Deno.serve(serveJson(async (req) => {
  const client = createUserClient(req);
  const usuario = await exigirUsuario(client);
  const body = await lerJson<Entrada>(req, 4096);
  if (typeof body.workspace_id !== "string" || !uuid.test(body.workspace_id)) {
    throw new HttpError(400, "Espaço de trabalho inválido.");
  }
  const workspaceId = body.workspace_id;

  const { data: workspace, error: workspaceError } = await client.from("workspaces")
    .select("id,owner_id").eq("id", workspaceId).maybeSingle();
  if (workspaceError) throw new HttpError(500, "Não foi possível confirmar o proprietário.");
  if (!workspace || workspace.owner_id !== usuario.id) {
    throw new HttpError(403, "Só o proprietário pode gerenciar a equipe.");
  }

  const admin = createAdminClient();
  if (body.action === "list") {
    const { data: membros, error } = await admin.from("workspace_members")
      .select("user_id,role,created_at").eq("workspace_id", workspaceId).order("created_at");
    if (error) throw new HttpError(500, "Não foi possível listar a equipe.");
    const equipe = await Promise.all((membros ?? []).map(async (membro) => {
      const { data, error: usuarioError } = await admin.auth.admin.getUserById(membro.user_id);
      if (usuarioError) throw new HttpError(500, "Não foi possível identificar um integrante.");
      return { ...membro, email: data.user?.email ?? "E-mail indisponível" };
    }));
    return { equipe };
  }

  if (body.action === "add") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !emailValido.test(email)) throw new HttpError(400, "Informe um e-mail válido.");
    let integrante = await encontrarUsuario(admin, email);
    if (!integrante) {
      // No invitation email is sent. The person requests their own magic link on /login.
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error) {
        integrante = await encontrarUsuario(admin, email);
        if (!integrante) throw new HttpError(500, "Não foi possível criar a conta da equipe.");
      } else integrante = data.user;
    }
    if (!integrante) throw new HttpError(500, "Não foi possível localizar a conta da equipe.");
    if (integrante.id === usuario.id) throw new HttpError(400, "Você já é o proprietário deste espaço.");
    const { data: existente, error: existeErro } = await admin.from("workspace_members")
      .select("user_id").eq("workspace_id", workspaceId).eq("user_id", integrante.id).maybeSingle();
    if (existeErro) throw new HttpError(500, "Não foi possível verificar a equipe.");
    if (existente) throw new HttpError(409, "Esta pessoa já faz parte da equipe.");
    const { error } = await admin.from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: integrante.id, role: "member" });
    if (error) throw new HttpError(500, "A conta foi criada, mas não foi possível conceder acesso. Tente novamente.");
    return { mensagem: "Acesso liberado. A pessoa já pode pedir o link na tela de login." };
  }

  if (body.action === "remove") {
    if (typeof body.user_id !== "string" || !uuid.test(body.user_id)) throw new HttpError(400, "Integrante inválido.");
    if (body.user_id === usuario.id) throw new HttpError(400, "O proprietário não pode ser removido.");
    const { data, error } = await admin.from("workspace_members")
      .delete().eq("workspace_id", workspaceId).eq("user_id", body.user_id)
      .neq("role", "owner").select("user_id");
    if (error) throw new HttpError(500, "Não foi possível remover o acesso.");
    if (!data?.length) throw new HttpError(404, "Integrante não encontrado.");
    return { mensagem: "Acesso removido." };
  }

  throw new HttpError(400, "Ação inválida.");
}));
