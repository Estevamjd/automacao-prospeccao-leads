/**
 * Processa tarefas SEM IA: pontuacao por regras do banco, auditoria por
 * criterio objetivo, parecer do consultor e rascunho por template.
 *
 * Correcoes: B2 (auth fecha), G4 (fila atomica via RPC), G5 (regras vem do
 * banco), G7 (nada de throw solto, tarefa nunca fica presa).
 */

import { HttpError, lerJson, serveJson } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/db.ts";
import { verifyWebhookSecret } from "../_shared/env.ts";
import { aplicarRegras, prepararEmpresaParaRegras, REGRAS_PADRAO, validarRegra, type Regra } from "../_shared/scoring.ts";
import { confidenceFromSignals } from "../_shared/signals.ts";
import { gerarBrief, origemDe, sinaisConfiaveisParaConsultoria, validarPlaybook, type Brief, type Playbook, type Remetente } from "../_shared/advisor.ts";
import { canalUsaAssunto, escolherCanal, jaTemOptOut, rodapeDoCanal, type ContatoDaEmpresa } from "../_shared/canal.ts";

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

Deno.serve(serveJson(async (req) => {
  const auth = verifyWebhookSecret(req);
  if (!auth.ok) throw new HttpError(auth.status, auth.erro);

  const body = await lerJson<{ task_id?: string; workspace_id?: string; worker?: string }>(req);
  const supabase = createAdminClient();
  const worker = body.worker ?? "rules-runner";

  // Duas formas de uso:
  //  - task_id: processa aquela tarefa (compatibilidade com o fluxo antigo)
  //  - workspace_id: pega a proxima da fila de forma atomica (recomendado)
  let tarefa: Record<string, unknown> | null = null;

  if (body.task_id) {
    const { data, error } = await supabase
      .from("agent_tasks")
      .update({ status: "running", locked_by: worker, locked_at: new Date().toISOString() })
      .eq("id", body.task_id)
      .eq("status", "pending")           // <- a condicao que faltava (G4)
      .select("*")
      .maybeSingle();

    if (error) throw new HttpError(500, `Falha ao travar a tarefa: ${error.message}`);
    if (!data) {
      throw new HttpError(409, "Essa tarefa já foi pega por outro processo ou não está pendente.");
    }
    tarefa = data;
  } else if (body.workspace_id) {
    const { data, error } = await supabase.rpc("claim_next_task", {
      target_workspace_id: body.workspace_id,
      worker_name: worker,
      allowed_types: ["analyze_company", "audit_company", "draft_outreach"],
    });

    if (error) throw new HttpError(500, `Falha ao pegar tarefa da fila: ${error.message}`);
    if (!data?.id) return { mensagem: "Nenhuma tarefa pendente agora.", processadas: 0 };
    tarefa = data;
  } else {
    throw new HttpError(400, "Informe task_id ou workspace_id.");
  }

  const taskId = tarefa!.id as string;
  const inicio = new Date().toISOString();

  try {
    const resultado = await processar(supabase, tarefa!);

    await supabase.from("agent_runs").insert({
      workspace_id: tarefa!.workspace_id,
      task_id: taskId,
      agent_name: `regras_${tarefa!.task_type}`,
      model_provider: "manual",
      model_name: "regras-v2",
      status: "completed",
      input: { task_type: tarefa!.task_type, company_id: tarefa!.company_id },
      output: resultado as Record<string, unknown>,
      started_at: inicio,
      finished_at: new Date().toISOString(),
    });

    await supabase.rpc("complete_task", { target_task_id: taskId, task_result: resultado });

    return { task_id: taskId, tipo: tarefa!.task_type, resultado, processadas: 1 };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    // A tarefa SEMPRE volta para um estado consistente, mesmo se algo estourar.
    const { data: novoStatus } = await supabase.rpc("fail_task", {
      target_task_id: taskId,
      message: mensagem,
    });

    throw new HttpError(500, `Tarefa falhou: ${mensagem}`, { task_id: taskId, novo_status: novoStatus });
  }
}));

// -----------------------------------------------------------------------------

async function processar(supabase: Supabase, tarefa: Record<string, unknown>) {
  if (!tarefa.company_id) {
    throw new Error("Tarefa sem company_id.");
  }

  const { data: empresa, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", tarefa.company_id)
    .single();

  if (error) throw new Error(`Empresa não encontrada: ${error.message}`);

  if (["contacted", "responded", "meeting_scheduled", "won", "lost"].includes(empresa.status)) {
    return { ignorada: true, motivo: "Empresa em acompanhamento comercial; etapa preservada." };
  }

  switch (tarefa.task_type) {
    case "analyze_company": return analisar(supabase, empresa);
    case "audit_company":   return auditar(supabase, empresa);
    case "draft_outreach":  return rascunhar(supabase, empresa);
    default:
      throw new Error(`Tipo de tarefa não suportado no modo sem IA: ${tarefa.task_type}`);
  }
}

/** Carrega as regras ativas do workspace; cai no padrao se nao houver. */
async function carregarRegras(supabase: Supabase, workspaceId: string): Promise<{ regras: Regra[]; origem: string }> {
  const { data } = await supabase
    .from("rule_sets")
    .select("name, rules")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  const bruto = data?.[0]?.rules;
  if (!Array.isArray(bruto)) return { regras: REGRAS_PADRAO, origem: "padrão embutido" };

  const regras = bruto.map(validarRegra).filter((r): r is Regra => r !== null);
  if (regras.length === 0) return { regras: REGRAS_PADRAO, origem: "padrão embutido (rule_set vazio ou inválido)" };

  return { regras, origem: data![0].name ?? "rule_set do workspace" };
}

async function carregarPlaybooks(supabase: Supabase, workspaceId: string): Promise<Playbook[]> {
  const { data } = await supabase
    .from("niche_playbooks")
    .select("slug, label, match_terms, weight, pains, offers, opening_questions, avoid, apresentacao")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  return (data ?? []).map(validarPlaybook).filter((p): p is Playbook => p !== null);
}

/**
 * Quem assina a abordagem. Vem de workspaces.settings.remetente (nome, bairro,
 * contato), com o bairro do workspace como reserva. A mensagem se apresenta
 * pela pessoa ("Aqui e o Estevam, sou de Olaria"); a marca fica no
 * perfil do WhatsApp Business, que o cliente ve no cabecalho da conversa.
 */
type RemetenteCompleto = Remetente & { contato?: string | null };

async function carregarRemetente(supabase: Supabase, workspaceId: string): Promise<RemetenteCompleto> {
  const { data } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .maybeSingle();

  const cfg = (data?.settings ?? {}) as Record<string, unknown>;
  const r = (cfg.remetente ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  return {
    nome: texto(r.nome) ?? texto(Deno.env.get("REMETENTE_NOME")),
    bairro: texto(r.bairro) ?? texto(cfg.neighborhood),
    contato: texto(r.contato) ?? texto(Deno.env.get("REMETENTE_CONTATO")),
  };
}

async function analisar(supabase: Supabase, empresa: Record<string, unknown>) {
  const workspaceId = empresa.workspace_id as string;

  const [{ regras, origem }, playbooks, remetente] = await Promise.all([
    carregarRegras(supabase, workspaceId),
    carregarPlaybooks(supabase, workspaceId),
    carregarRemetente(supabase, workspaceId),
  ]);

  const { score, motivos, regras_aplicadas, bloqueada } = aplicarRegras(prepararEmpresaParaRegras(empresa), regras);
  const signals = sinaisConfiaveisParaConsultoria((empresa.signals ?? {}) as Record<string, boolean | string | number | null>);
  const confianca = confidenceFromSignals(signals);

  // O parecer do consultor: o "amigo" que diz o que propor.
  const brief: Brief = gerarBrief(
    {
      name: empresa.name as string,
      nicho: empresa.nicho as string | null,
      category: empresa.category as string | null,
      city: empresa.city as string | null,
      signals,
      // Lead do cadastro de CNPJ (I10) nao foi "visto no mapa": a frase muda.
      origem: origemDe(empresa.metadata as Record<string, unknown> | null),
    },
    playbooks,
    confianca,
    { nome: remetente.nome, bairro: remetente.bairro },
  );

  const status = bloqueada ? "rejected" : score >= 70 ? "qualified" : score >= 45 ? "researching" : "rejected";

  await supabase
    .from("companies")
    .update({
      score,
      status,
      confidence_score: brief.confianca,
      fit_summary: motivos.join(". ") || "Sem sinais fortes identificados.",
      pain_points: brief.diagnostico.map((d) => d.texto),
      recommended_offer: brief.oferta_principal?.titulo ?? null,
      advisor_brief: brief,
    })
    .eq("id", empresa.id);

  // Só segue para auditoria quem não foi rejeitado — não faz sentido gastar
  // etapa com lead que as próprias regras já descartaram.
  if (status !== "rejected") {
    await enfileirar(supabase, {
      workspace_id: workspaceId,
      company_id: empresa.id,
      task_type: "audit_company",
      priority: score >= 70 ? 75 : 50,
    });
  }

  return { score, status, origem_das_regras: origem, regras_aplicadas, motivos, consultor: brief };
}

async function auditar(supabase: Supabase, empresa: Record<string, unknown>) {
  const problemas: string[] = [];
  const observacoes: string[] = [];
  const signals = (empresa.signals ?? {}) as Record<string, unknown>;

  // BLOQUEIOS: coisas que tornam a abordagem impossível ou inútil.
  //
  // Nota de projeto: a AUSÊNCIA de site NÃO bloqueia, e isso é deliberado.
  // A versão anterior barrava lead "sem presença digital" — o que contradizia
  // o consultor, que trata justamente essa ausência como o gancho de venda.
  // Na prática todo bom lead ficava preso em revisão humana e a mensagem
  // nunca era escrita. Quem vende presença digital quer exatamente o negócio
  // que ainda não tem.
  if (!empresa.main_phone && !empresa.main_email && !signals.has_whatsapp) {
    problemas.push("A fonte não informou telefone, e-mail ou WhatsApp. Confirme um canal de contato antes de abordar.");
  }
  if ((empresa.score as number ?? 0) < 45) {
    problemas.push("Score abaixo do mínimo para abordagem.");
  }
  if (signals.is_chain === true) {
    problemas.push("Parece rede ou franquia — a decisão provavelmente não é na loja.");
  }
  if (empresa.opt_out_at) {
    problemas.push("Esta empresa pediu para não ser contatada.");
  }

  // OBSERVAÇÕES: não impedem a abordagem; são o ângulo de venda ou um alerta
  // de que a confiança do diagnóstico é menor.
  if (!empresa.website_url && !empresa.domain) {
    observacoes.push("A fonte não informou site. Confirme se a empresa já tem um antes de sugerir esse serviço.");
  }
  if (!signals.has_instagram) {
    observacoes.push("Sem Instagram listado: pode existir e não estar no OpenStreetMap. Vale conferir antes de falar disso.");
  }
  if ((empresa.confidence_score as number ?? 1) < 0.45) {
    observacoes.push("Cadastro pobre na fonte: o diagnóstico é um palpite fraco. Confira antes de investir tempo.");
  }

  const aprovado = problemas.length === 0;

  await supabase
    .from("companies")
    .update({ status: aprovado ? "ready_for_outreach" : "researching" })
    .eq("id", empresa.id);

  await supabase.from("activities").insert({
    workspace_id: empresa.workspace_id,
    company_id: empresa.id,
    activity_type: aprovado ? "system" : "human_review",
    title: aprovado ? "Aprovado pelas regras" : "Precisa de revisão sua",
    body: aprovado
      ? ["Critérios mínimos atendidos.", ...observacoes].join(" ")
      : problemas.join(" "),
    metadata: { sem_ia: true, problemas, observacoes },
  });

  await enfileirar(supabase, {
    workspace_id: empresa.workspace_id,
    company_id: empresa.id,
    task_type: aprovado ? "draft_outreach" : "human_review",
    priority: aprovado ? 70 : 90,
  });

  return { aprovado, problemas, observacoes, proximo_status: aprovado ? "ready_for_outreach" : "researching" };
}

async function rascunhar(supabase: Supabase, empresa: Record<string, unknown>) {
  // LGPD: última barreira antes de gerar mensagem.
  const { data: suprimido } = await supabase.rpc("is_suppressed", {
    target_workspace_id: empresa.workspace_id,
    phone: empresa.main_phone ?? null,
    email: empresa.main_email ?? null,
    company_domain: empresa.domain ?? null,
    ref: empresa.source_ref ?? null,
  });

  if (suprimido === true || empresa.opt_out_at) {
    await supabase.from("companies").update({ status: "rejected" }).eq("id", empresa.id);
    return { pulado: true, motivo: "Empresa está na lista de supressão. Nenhuma mensagem foi gerada." };
  }

  // Se ja existe um rascunho aberto para esta empresa, nao escreve outro.
  //
  // Sem isto, cada nova passada da esteira criava mais um rascunho para o mesmo
  // lead — na base real tres empresas ficaram com duas versoes. O banco tambem
  // garante (indice unico parcial + gatilho que cancela o anterior); checar
  // aqui evita trabalho inutil e mantem o retorno da tarefa honesto.
  const { data: jaTem, error: erroRascunho } = await supabase
    .from("outreach_messages")
    .select("id")
    .eq("company_id", empresa.id)
    .eq("status", "draft")
    .is("sent_at", null)
    .limit(1);

  if (erroRascunho) {
    throw new Error(`Falha ao conferir rascunhos existentes: ${erroRascunho.message}`);
  }

  if (jaTem && jaTem.length > 0) {
    return {
      pulado: true,
      message_id: jaTem[0].id,
      motivo: "Esta empresa já tem um rascunho aberto esperando envio. Não escrevi outro.",
    };
  }

  const brief = empresa.advisor_brief as Brief | null;

  // O canal sai do contato que a empresa REALMENTE tem — nunca da ordem dos
  // templates. Ver o comentario em _shared/canal.ts: quando o canal vinha do
  // template, dois templates com o mesmo created_at tornavam a ordenacao
  // instavel e leads so-telefone saiam marcados como "email".
  const canal = escolherCanal(empresa as ContatoDaEmpresa);

  // Procura primeiro um template DO canal escolhido.
  const { data: doCanal } = await supabase
    .from("message_templates")
    .select("id, channel, subject_template, body_template")
    .eq("workspace_id", empresa.workspace_id)
    .eq("is_active", true)
    .eq("channel", canal)
    .order("created_at", { ascending: true })
    .limit(1);

  let template = doCanal?.[0];

  // Sem template do canal, qualquer ativo serve como MOLDE DE TEXTO. O canal
  // continua sendo o nosso: o template emprestou a redacao, nao a decisao.
  if (!template) {
    const { data: qualquer } = await supabase
      .from("message_templates")
      .select("id, channel, subject_template, body_template")
      .eq("workspace_id", empresa.workspace_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1);
    template = qualquer?.[0];
  }

  // Se o consultor já escreveu uma abertura sob medida, ela ganha do template
  // genérico — é personalizada com o diagnóstico real daquele lead.
  //
  // Telefone FIXO nao tem WhatsApp: o que o Estevam precisa ali e um roteiro
  // para ler na ligacao, nao uma mensagem para colar (23/09: 14 das 15
  // mensagens "de WhatsApp" eram para fixo e nao tinham como ser enviadas).
  // Brief antigo (antes de 23/09) nao tem roteiro: cai na abertura.
  const textoDoConsultor = canal === "phone"
    ? (brief?.roteiro_ligacao ?? brief?.abertura)
    : brief?.abertura;

  const textoBase = textoDoConsultor
    ?? (template ? renderizar(template.body_template, empresa, brief) : abordagemPadrao(empresa));

  // LGPD: toda mensagem sai identificada e com saída fácil. Isso não é enfeite
  // — é o que sustenta a base legal de legítimo interesse (art. 7º, IX c/c
  // art. 9º e art. 18). Se o texto já pedir descadastro, não duplica.
  // Na ligacao o rodape e vazio: a saida esta no proprio roteiro.
  const remetente = await carregarRemetente(supabase, empresa.workspace_id as string);
  const corpo = jaTemOptOut(textoBase)
    ? textoBase
    : textoBase + rodapeDoCanal(canal, {
        nome: remetente.nome ?? undefined,
        contato: remetente.contato ?? undefined,
      });

  // Assunto so faz sentido em e-mail. Mandar "assunto" no WhatsApp e ruido.
  const assunto = canalUsaAssunto(canal) && template?.subject_template
    ? renderizar(template.subject_template, empresa, brief)
    : null;

  const { data: mensagem, error } = await supabase
    .from("outreach_messages")
    .insert({
      workspace_id: empresa.workspace_id,
      company_id: empresa.id,
      template_id: template?.id ?? null,
      channel: canal,
      status: "draft",
      subject: assunto,
      body: corpo,
      personalization_used: brief ? ["segmento", "diagnóstico", "oferta"] : ["nome"],
    })
    .select("id")
    .single();

  if (error) throw new Error(`Falha ao criar rascunho: ${error.message}`);

  // O follow-up NAO nasce aqui, e isso e deliberado.
  //
  // Antes era criado junto com o rascunho, prazo de 3 dias, sem saber se a
  // mensagem seria enviada: na base real sobraram cinco follow-ups vencidos de
  // mensagens que nunca sairam. Cobranca de algo que nao aconteceu e o jeito
  // mais rapido de alguem parar de olhar o alerta. Quem cria agora e o gatilho
  // trg_outreach_ao_enviar, quando sent_at e preenchido.

  return {
    message_id: mensagem.id,
    canal,
    corpo,
    segunda_mensagem: canal === "phone" ? null : brief?.segunda_mensagem ?? null,
    o_que_evitar: brief?.o_que_evitar ?? [],
    proximo_passo: brief?.proximo_passo ?? null,
  };
}

function renderizar(template: string, empresa: Record<string, unknown>, brief: Brief | null): string {
  return template
    .replaceAll("{{company_name}}", String(empresa.name ?? ""))
    .replaceAll("{{recommended_offer}}", brief?.oferta_principal?.titulo ?? String(empresa.recommended_offer ?? "melhorar o atendimento"))
    .replaceAll("{{city}}", String(empresa.city ?? ""))
    .replaceAll("{{segmento}}", brief?.segmento ?? "");
}

function abordagemPadrao(empresa: Record<string, unknown>): string {
  return `Oi, tudo bem? Vi ${empresa.name} aqui e queria trocar uma ideia rápida sobre atendimento. Hoje vocês já resolvem isso de algum jeito?`;
}
