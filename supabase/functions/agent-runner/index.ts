/**
 * Processa tarefas COM IA (modo opcional, USE_AI_AGENT_RUNNER=true).
 *
 * Correcoes: B2 (auth fecha), G4 (trava atomica), G6 (saida do modelo validada
 * antes de tocar o banco + defesa contra injecao de prompt), G7 (nada de throw
 * solto). O parecer do consultor por regras continua sendo gerado e vai junto
 * como contexto - a IA melhora o texto, nao substitui o diagnostico.
 */

import { HttpError, lerJson, serveJson } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/db.ts";
import { verifyWebhookSecret } from "../_shared/env.ts";
import { callJsonLlm, type LlmProvider } from "../_shared/llm.ts";
import {
  AVISO_ANTI_INJECAO,
  empacotarDadoNaoConfiavel,
  sanearAbordagem,
  sanearAnalise,
  sanearAuditoria,
} from "../_shared/validation.ts";

/**
 * Coloca uma tarefa na fila.
 *
 * NAO usar upsert com ON CONFLICT aqui: o indice que impede fila duplicada e
 * parcial (so vale para pending/running) e o PostgreSQL recusa ON CONFLICT
 * contra indice parcial (erro 42P10). A funcao enfileirar_tarefa no banco faz
 * o insert e trata a duplicata como comportamento esperado.
 */
async function enfileirar(
  supabase: ReturnType<typeof createAdminClient>,
  tarefa: {
    workspace_id: unknown;
    company_id: unknown;
    task_type: string;
    priority?: number;
    payload?: unknown;
  },
): Promise<void> {
  const { error } = await supabase.rpc("enfileirar_tarefa", {
    target_workspace_id: tarefa.workspace_id,
    target_company_id: tarefa.company_id,
    tipo: tarefa.task_type,
    prioridade: tarefa.priority ?? 50,
    dados: tarefa.payload ?? {},
  });

  // Erro aqui precisa aparecer: quando isso falhava em silencio, a esteira
  // inteira parava sem ninguem perceber.
  if (error) {
    throw new Error(`Falha ao enfileirar ${tarefa.task_type}: ${error.message}`);
  }
}

type Supabase = ReturnType<typeof createAdminClient>;

const TIPOS_SUPORTADOS = ["analyze_company", "audit_company", "draft_outreach"] as const;

const PROMPTS: Record<string, string> = {
  analyze_company: `Você é o agente analista de prospecção comercial no Brasil.
Analise SOMENTE os dados fornecidos. Não invente informação que não esteja ali.
Se faltar dado para concluir algo, diga em missing_data em vez de chutar.

${AVISO_ANTI_INJECAO}

Responda JSON válido com: score (0 a 100), status, fit_summary, pain_points (lista),
recommended_offer, confidence_score (0 a 1), reasoning_short, missing_data (lista).`,

  audit_company: `Você é o agente auditor de qualidade de leads.
Procure duplicidade provável, falta de evidência, contato inconsistente e risco comercial.
Na dúvida, NÃO aprove: um lead ruim que passa custa mais caro que um bom que espera.

${AVISO_ANTI_INJECAO}

Responda JSON válido com: approved (booleano), risk_level, issues (lista),
required_actions (lista), next_status, confidence_score (0 a 1).`,

  draft_outreach: `Você é o agente de abordagem comercial, escrevendo em português do Brasil.
Escreva mensagem curta, humana e específica, com UMA pergunta simples no final.
Nada de jargão corporativo, nada de promessa de resultado, nada de "transformação digital".
Use o diagnóstico do consultor que vem no contexto: ele diz o que provavelmente dói nesse negócio.

${AVISO_ANTI_INJECAO}

Responda JSON válido com: channel, subject, body, personalization_used (lista), follow_up_days.`,
};

Deno.serve(serveJson(async (req) => {
  const auth = verifyWebhookSecret(req);
  if (!auth.ok) throw new HttpError(auth.status, auth.erro);

  const body = await lerJson<{
    task_id?: string;
    workspace_id?: string;
    provider?: string;
    model?: string;
    worker?: string;
  }>(req);

  const supabase = createAdminClient();
  const provider = (body.provider === "anthropic" ? "anthropic" : "openai") as LlmProvider;
  const worker = body.worker ?? "agent-runner";

  let tarefa: Record<string, unknown> | null = null;

  if (body.task_id) {
    const { data, error } = await supabase
      .from("agent_tasks")
      .update({ status: "running", locked_by: worker, locked_at: new Date().toISOString() })
      .eq("id", body.task_id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) throw new HttpError(500, `Falha ao travar a tarefa: ${error.message}`);
    if (!data) throw new HttpError(409, "Tarefa já processada ou não está pendente.");
    tarefa = data;
  } else if (body.workspace_id) {
    const { data, error } = await supabase.rpc("claim_next_task", {
      target_workspace_id: body.workspace_id,
      worker_name: worker,
      allowed_types: [...TIPOS_SUPORTADOS],
    });
    if (error) throw new HttpError(500, `Falha ao pegar tarefa: ${error.message}`);
    if (!data?.id) return { mensagem: "Nenhuma tarefa pendente agora.", processadas: 0 };
    tarefa = data;
  } else {
    throw new HttpError(400, "Informe task_id ou workspace_id.");
  }

  const taskId = tarefa!.id as string;
  const tipo = String(tarefa!.task_type);

  if (!TIPOS_SUPORTADOS.includes(tipo as typeof TIPOS_SUPORTADOS[number])) {
    await supabase.rpc("fail_task", { target_task_id: taskId, message: `Tipo não suportado: ${tipo}` });
    throw new HttpError(400, `Tipo de tarefa não suportado pelo agent-runner: ${tipo}`);
  }

  const inicio = new Date().toISOString();

  try {
    const contexto = await carregarContexto(supabase, tarefa!);

    // Dado de terceiro vai isolado entre delimitadores (defesa de injeção).
    const entrada = {
      instrucao: `Tarefa: ${tipo}.`,
      dados: empacotarDadoNaoConfiavel("contexto_do_lead", contexto),
    };

    const bruto = await callJsonLlm({
      provider,
      system: PROMPTS[tipo],
      user: entrada,
      model: body.model,
    });

    const saida = await aplicarSaida(supabase, tarefa!, tipo, bruto);

    const { data: run } = await supabase.from("agent_runs").insert({
      workspace_id: tarefa!.workspace_id,
      task_id: taskId,
      agent_name: tipo,
      model_provider: provider,
      model_name: body.model ?? null,
      status: "completed",
      input: { tipo, company_id: tarefa!.company_id },
      output: saida as Record<string, unknown>,
      started_at: inicio,
      finished_at: new Date().toISOString(),
    }).select("id").single();

    await supabase.rpc("complete_task", { target_task_id: taskId, task_result: saida });

    return { task_id: taskId, run_id: run?.id, tipo, saida, processadas: 1 };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    await supabase.from("agent_runs").insert({
      workspace_id: tarefa!.workspace_id,
      task_id: taskId,
      agent_name: tipo,
      model_provider: provider,
      model_name: body.model ?? null,
      status: "failed",
      input: { tipo },
      output: {},
      error_message: mensagem,
      started_at: inicio,
      finished_at: new Date().toISOString(),
    });

    const { data: novoStatus } = await supabase.rpc("fail_task", {
      target_task_id: taskId,
      message: mensagem,
    });

    throw new HttpError(500, `Tarefa falhou: ${mensagem}`, { task_id: taskId, novo_status: novoStatus });
  }
}));

// -----------------------------------------------------------------------------

async function carregarContexto(supabase: Supabase, tarefa: Record<string, unknown>) {
  const companyId = tarefa.company_id as string | null;
  if (!companyId) return {};

  const [empresa, contatos, evidencias] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).single(),
    supabase.from("contacts").select("full_name, role_title, email, phone, channel_preference").eq("company_id", companyId).limit(10),
    supabase.from("evidence_items").select("title, source_url, extracted_text, observed_at").eq("company_id", companyId).limit(10),
  ]);

  if (empresa.error) throw new Error(`Empresa não encontrada: ${empresa.error.message}`);

  return {
    empresa: empresa.data,
    // O parecer por regras vai junto: a IA parte de um diagnóstico já feito
    // em vez de começar do zero, o que deixa a saída bem mais consistente.
    consultor_por_regras: empresa.data?.advisor_brief ?? null,
    contatos: contatos.data ?? [],
    evidencias: evidencias.data ?? [],
  };
}

async function aplicarSaida(
  supabase: Supabase,
  tarefa: Record<string, unknown>,
  tipo: string,
  bruto: Record<string, unknown>,
) {
  const companyId = tarefa.company_id as string;
  const workspaceId = tarefa.workspace_id as string;

  if (tipo === "analyze_company") {
    // AQUI estava o achado G6: antes ia direto para o UPDATE.
    const saida = sanearAnalise(bruto);

    await supabase.from("companies").update({
      score: saida.score,
      status: saida.status,
      confidence_score: saida.confidence_score,
      fit_summary: saida.fit_summary,
      pain_points: saida.pain_points,
      recommended_offer: saida.recommended_offer,
    }).eq("id", companyId);

    if (saida.status !== "rejected") {
      await enfileirar(supabase, {
        workspace_id: workspaceId,
        company_id: companyId,
        task_type: "audit_company",
        priority: 70,
      });
    }

    return saida;
  }

  if (tipo === "audit_company") {
    const saida = sanearAuditoria(bruto);

    await supabase.from("companies")
      .update({ status: saida.approved ? "ready_for_outreach" : saida.next_status })
      .eq("id", companyId);

    await supabase.from("activities").insert({
      workspace_id: workspaceId, company_id: companyId,
      activity_type: saida.approved ? "system" : "human_review",
      title: saida.approved ? "Auditoria aprovada" : "Auditoria pediu atenção",
      body: saida.issues.join(" ") || "Sem ressalvas.",
      metadata: { por_ia: true },
    });

    await enfileirar(supabase, {
      workspace_id: workspaceId,
      company_id: companyId,
      task_type: saida.approved ? "draft_outreach" : "human_review",
      priority: saida.approved ? 70 : 90,
    });

    return saida;
  }

  // draft_outreach
  const saida = sanearAbordagem(bruto);
  if (!saida) {
    throw new Error("O modelo não devolveu o corpo da mensagem. Nada foi gravado.");
  }

  // LGPD: última barreira, igual ao caminho sem IA.
  const { data: empresa } = await supabase
    .from("companies").select("main_phone, main_email, domain, source_ref, opt_out_at")
    .eq("id", companyId).single();

  const { data: suprimido } = await supabase.rpc("is_suppressed", {
    target_workspace_id: workspaceId,
    phone: empresa?.main_phone ?? null,
    email: empresa?.main_email ?? null,
    company_domain: empresa?.domain ?? null,
    ref: empresa?.source_ref ?? null,
  });

  if (suprimido === true || empresa?.opt_out_at) {
    return { pulado: true, motivo: "Empresa na lista de supressão; nenhuma mensagem gravada." };
  }

  const { data: mensagem, error } = await supabase.from("outreach_messages").insert({
    workspace_id: workspaceId,
    company_id: companyId,
    contact_id: tarefa.contact_id ?? null,
    channel: saida.channel,
    status: "draft",
    subject: saida.subject,
    body: saida.body,
    personalization_used: saida.personalization_used,
  }).select("id").single();

  if (error) throw new Error(`Falha ao gravar a mensagem: ${error.message}`);

  await supabase.from("follow_ups").insert({
    workspace_id: workspaceId,
    company_id: companyId,
    message_id: mensagem.id,
    due_at: new Date(Date.now() + saida.follow_up_days * 86_400_000).toISOString(),
    notes: "Follow-up criado junto com o rascunho.",
  });

  return { ...saida, message_id: mensagem.id };
}
