/**
 * Dados do painel.
 *
 * Esta e a funcao do achado B1, o mais grave da auditoria. Antes ela nao tinha
 * autenticacao NENHUMA, usava a chave de administrador (que ignora o RLS) e
 * aceitava workspace_id do corpo da requisicao. Como esse id esta publicado no
 * README, qualquer um com a URL baixava a base inteira.
 *
 * Agora: exige JWT de usuario, cria o client NO CONTEXTO desse usuario e deixa
 * o RLS filtrar. O workspace_id continua vindo do cliente, mas pedir o de
 * outra pessoa simplesmente devolve vazio - o banco nao entrega.
 */

import { HttpError, lerJson, serveJson } from "../_shared/http.ts";
import { createUserClient, exigirUsuario } from "../_shared/db.ts";

Deno.serve(serveJson(async (req) => {
  const supabase = createUserClient(req);
  const usuario = await exigirUsuario(supabase);

  const body = await lerJson<{ workspace_id?: string }>(req);
  let workspaceId = body.workspace_id;

  // Sem workspace informado, usamos o primeiro que o usuario tem acesso.
  // O RLS ja limita o que aparece aqui.
  if (!workspaceId) {
    const { data } = await supabase.from("workspaces").select("id").limit(1);
    workspaceId = data?.[0]?.id;
    if (!workspaceId) {
      throw new HttpError(404, "Sua conta ainda não está ligada a nenhum workspace.");
    }
  }

  // Confirma o acesso de forma explicita, para devolver 403 com mensagem clara
  // em vez de um painel vazio e confuso.
  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .maybeSingle();

  if (wsError) throw new HttpError(500, `Erro ao consultar o workspace: ${wsError.message}`);
  if (!workspace) {
    throw new HttpError(403, "Você não tem acesso a este workspace.");
  }

  const [empresas, tarefas, followUps, atividades, memoria, desempenho] = await Promise.all([
    supabase.from("companies")
      .select("id,name,status,score,city,state,category,fit_summary,recommended_offer,advisor_brief,signals,opt_out_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("score", { ascending: false, nullsFirst: false })
      .limit(60),
    supabase.from("agent_tasks")
      .select("id,task_type,status,priority,company_id,run_after,error_message,attempts")
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "running", "failed"])
      .order("priority", { ascending: false })
      .limit(40),
    supabase.from("follow_ups")
      .select("id,status,due_at,notes,company_id")
      .eq("workspace_id", workspaceId).eq("status", "scheduled")
      .order("due_at", { ascending: true }).limit(15),
    supabase.from("activities")
      .select("id,activity_type,title,body,happened_at")
      .eq("workspace_id", workspaceId)
      .order("happened_at", { ascending: false }).limit(12),
    supabase.from("knowledge_notes")
      .select("title,vault_path,summary,sync_status,synced_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }).limit(6),
    supabase.from("outreach_performance")
      .select("template_name,channel,enviadas,respondidas,taxa_resposta_pct")
      .eq("workspace_id", workspaceId).limit(10),
  ]);

  for (const r of [empresas, tarefas, followUps, atividades, memoria, desempenho]) {
    if (r.error) throw new HttpError(500, `Erro ao consultar dados: ${r.error.message}`);
  }

  const listaEmpresas = empresas.data ?? [];
  const scores = listaEmpresas.map((c) => c.score ?? 0).filter((s) => s > 0);

  return {
    connected: true,
    usuario: usuario.email ?? usuario.id,
    workspaceId,
    workspaceName: workspace.name,
    summary: {
      companies: listaEmpresas.length,
      qualified: listaEmpresas.filter((c) => c.status === "qualified").length,
      ready: listaEmpresas.filter((c) => c.status === "ready_for_outreach").length,
      contacted: listaEmpresas.filter((c) => c.status === "contacted").length,
      optOut: listaEmpresas.filter((c) => c.opt_out_at).length,
      pendingTasks: (tarefas.data ?? []).filter((t) => t.status === "pending").length,
      failedTasks: (tarefas.data ?? []).filter((t) => t.status === "failed").length,
      scheduledFollowUps: (followUps.data ?? []).length,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    },
    companies: listaEmpresas,
    tasks: tarefas.data ?? [],
    followUps: followUps.data ?? [],
    activities: atividades.data ?? [],
    memory: memoria.data ?? [],
    performance: desempenho.data ?? [],
  };
}));
