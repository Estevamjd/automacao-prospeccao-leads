/**
 * Importa leads vindos do n8n ou do painel.
 *
 * Correcoes em relacao a versao anterior:
 *  - B2: autenticacao falha fechada
 *  - G3: deduplicacao por source_ref (chave estavel da fonte)
 *  - G7: nada de throw solto; todo erro vira resposta JSON
 *  - LGPD: consulta a lista de supressao antes de gravar
 *  - lote limitado e gravacao em bloco, para nao estourar o tempo da funcao
 */

import { HttpError, lerJson, serveJson } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/db.ts";
import { verifyWebhookSecret } from "../_shared/env.ts";
import { extractSignals } from "../_shared/signals.ts";

const LIMITE_LEADS_POR_CHAMADA = 200;

type LeadRecebido = {
  name: string;
  source_ref?: string;
  website_url?: string;
  domain?: string;
  main_phone?: string;
  main_email?: string;
  address_line?: string;
  city?: string;
  state?: string;
  country?: string;
  category?: string;
  source_url?: string;
  raw_data?: Record<string, unknown>;
};

Deno.serve(serveJson(async (req) => {
  const auth = verifyWebhookSecret(req);
  if (!auth.ok) throw new HttpError(auth.status, auth.erro);

  const body = await lerJson<{
    workspace_id?: string;
    leads?: LeadRecebido[];
    source_type?: string;
    source_name?: string;
    source_url?: string;
    query?: Record<string, unknown>;
  }>(req, 5_000_000);

  const workspaceId = body.workspace_id;
  const leads = body.leads;

  if (!workspaceId || !Array.isArray(leads)) {
    throw new HttpError(400, "workspace_id e leads[] são obrigatórios.");
  }

  if (leads.length === 0) {
    return { source_id: null, importados: 0, resultados: [], mensagem: "Nenhum lead recebido." };
  }

  if (leads.length > LIMITE_LEADS_POR_CHAMADA) {
    throw new HttpError(
      413,
      `Máximo de ${LIMITE_LEADS_POR_CHAMADA} leads por chamada (recebi ${leads.length}). ` +
      `Divida em lotes menores — a Edge Function tem tempo limitado.`,
    );
  }

  const supabase = createAdminClient();

  // 1. Registra a fonte desta importacao
  const { data: source, error: sourceError } = await supabase
    .from("lead_sources")
    .insert({
      workspace_id: workspaceId,
      source_type: body.source_type ?? "manual",
      name: body.source_name ?? "Importação",
      source_url: body.source_url ?? null,
      query: body.query ?? {},
    })
    .select("id")
    .single();

  if (sourceError) {
    throw new HttpError(500, `Não consegui registrar a fonte: ${sourceError.message}`);
  }

  // 2. Carrega a lista de supressao UMA vez, em vez de consultar por lead.
  const { data: supressoes } = await supabase
    .from("suppression_list")
    .select("match_type, match_value")
    .eq("workspace_id", workspaceId);

  const suprimidos = {
    phone: new Set<string>(),
    email: new Set<string>(),
    domain: new Set<string>(),
    source_ref: new Set<string>(),
  };
  for (const s of supressoes ?? []) {
    const conjunto = suprimidos[s.match_type as keyof typeof suprimidos];
    if (conjunto) conjunto.add(s.match_value);
  }

  // 3. Prepara os registros, ja deduplicando dentro do proprio lote
  const agora = new Date().toISOString();
  const vistos = new Set<string>();
  const paraGravar: Record<string, unknown>[] = [];
  const resultados: Array<{ name: string; status: string; motivo?: string }> = [];

  for (const lead of leads) {
    if (!lead?.name?.trim()) {
      resultados.push({ name: String(lead?.name ?? "(sem nome)"), status: "ignorado", motivo: "sem nome" });
      continue;
    }

    const domain = normalizarDominio(lead.domain ?? lead.website_url);
    const telefone = normalizarTelefone(lead.main_phone);
    const email = lead.main_email?.trim().toLowerCase() ?? null;
    const sourceRef = lead.source_ref ?? derivarSourceRef(lead.raw_data);

    // LGPD: quem pediu para nao ser contatado nao entra de novo na base.
    const motivoSupressao = verificarSupressao(suprimidos, { telefone, email, domain, sourceRef });
    if (motivoSupressao) {
      resultados.push({ name: lead.name, status: "suprimido", motivo: motivoSupressao });
      continue;
    }

    // Deduplicacao dentro do lote (o banco cuida da dedup entre lotes)
    const chaveLote = sourceRef ?? `${normalizarNome(lead.name)}|${lead.city ?? ""}|${lead.state ?? ""}`;
    if (vistos.has(chaveLote)) {
      resultados.push({ name: lead.name, status: "duplicado_no_lote" });
      continue;
    }
    vistos.add(chaveLote);

    const tags = (lead.raw_data?.tags ?? {}) as Record<string, string>;

    paraGravar.push({
      workspace_id: workspaceId,
      source_id: source.id,
      source_ref: sourceRef,
      name: lead.name.trim(),
      normalized_name: normalizarNome(lead.name),
      website_url: lead.website_url ?? null,
      domain,
      main_phone: lead.main_phone ?? null,
      main_email: email,
      address_line: lead.address_line ?? null,
      city: lead.city ?? null,
      state: lead.state ?? null,
      country: lead.country ?? "BR",
      category: lead.category ?? null,
      status: "new",
      metadata: lead.raw_data ?? {},
      signals: extractSignals(tags),
      last_seen_at: agora,
      // LGPD: procedencia registrada no momento da coleta
      consent_basis: "legitimate_interest",
      data_source_url: lead.source_url ?? body.source_url ?? null,
      data_collected_at: agora,
    });
  }

  if (paraGravar.length === 0) {
    return {
      source_id: source.id,
      importados: 0,
      resultados,
      mensagem: "Nenhum lead novo para gravar.",
    };
  }

  // 4. Grava tudo de uma vez.
  // onConflict em source_ref: reimportar o mesmo estabelecimento ATUALIZA a
  // linha (util, porque o cadastro no OSM melhora com o tempo) em vez de criar
  // duplicata ou estourar erro.
  const { data: gravadas, error: upsertError } = await supabase
    .from("companies")
    .upsert(paraGravar, { onConflict: "workspace_id,source_ref", ignoreDuplicates: false })
    .select("id, name, source_ref, status");

  if (upsertError) {
    throw new HttpError(500, `Falha ao gravar os leads: ${upsertError.message}`);
  }

  const empresas = gravadas ?? [];

  // 5. Evidencia e fila de analise, tambem em bloco
  if (empresas.length > 0) {
    const porRef = new Map(empresas.map((e) => [e.source_ref ?? e.name, e.id]));

    await supabase.from("evidence_items").insert(
      paraGravar.map((registro) => ({
        workspace_id: workspaceId,
        company_id: porRef.get((registro.source_ref as string) ?? (registro.name as string)),
        source_id: source.id,
        evidence_type: "lead_import",
        source_url: registro.data_source_url,
        title: `Importação: ${registro.name}`,
        raw_data: registro.metadata,
        confidence_score: 0.7,
      })).filter((e) => e.company_id),
    );

    // Só cria tarefa para empresa que ainda não foi analisada.
    //
    // Usamos a função enfileirar_tarefa em vez de upsert com ON CONFLICT.
    // Motivo: o índice que impede fila duplicada é PARCIAL (só vale para
    // status pending/running), e o PostgreSQL recusa ON CONFLICT contra índice
    // parcial com o erro 42P10. Antes isso falhava em silêncio e NENHUMA
    // tarefa era criada - o lead entrava e ficava parado em "new" para sempre.
    const novas = empresas.filter((e) => e.status === "new");
    const falhasNaFila: string[] = [];

    for (const empresa of novas) {
      const { error } = await supabase.rpc("enfileirar_tarefa", {
        target_workspace_id: workspaceId,
        target_company_id: empresa.id,
        tipo: "analyze_company",
        prioridade: 60,
        dados: { source_id: source.id },
      });

      // Checar o erro é o que faltava antes. Sem isso a falha some.
      if (error) falhasNaFila.push(`${empresa.name}: ${error.message}`);
    }

    if (falhasNaFila.length > 0) {
      console.error("[fila] não consegui enfileirar:", falhasNaFila);
      throw new HttpError(
        500,
        `Leads gravados, mas ${falhasNaFila.length} não entraram na fila de análise.`,
        falhasNaFila.slice(0, 5),
      );
    }
  }

  for (const e of empresas) {
    resultados.push({ name: e.name, status: "importado" });
  }

  return {
    source_id: source.id,
    importados: empresas.length,
    suprimidos: resultados.filter((r) => r.status === "suprimido").length,
    duplicados: resultados.filter((r) => r.status === "duplicado_no_lote").length,
    resultados,
  };
}));

// -----------------------------------------------------------------------------

function normalizarNome(valor: string): string {
  return valor.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizarDominio(valor?: string): string | null {
  if (!valor?.trim()) return null;
  try {
    const url = valor.startsWith("http") ? new URL(valor) : new URL(`https://${valor}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    const limpo = valor.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase().trim();
    return limpo || null;
  }
}

/** Mesma regra da funcao normalize_phone_br do banco, para os dois baterem. */
function normalizarTelefone(valor?: string | null): string | null {
  if (!valor) return null;
  let digitos = valor.replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (digitos.length > 11 && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length < 10 || digitos.length > 11) return null;
  return digitos;
}

function derivarSourceRef(rawData?: Record<string, unknown>): string | null {
  if (!rawData) return null;
  const tipo = rawData.osm_type;
  const id = rawData.osm_id;
  if (typeof tipo === "string" && (typeof id === "number" || typeof id === "string")) {
    return `osm:${tipo}/${id}`;
  }
  return null;
}

function verificarSupressao(
  listas: { phone: Set<string>; email: Set<string>; domain: Set<string>; source_ref: Set<string> },
  dados: { telefone: string | null; email: string | null; domain: string | null; sourceRef: string | null },
): string | null {
  if (dados.telefone && listas.phone.has(dados.telefone)) return "telefone na lista de supressão";
  if (dados.email && listas.email.has(dados.email)) return "e-mail na lista de supressão";
  if (dados.domain && listas.domain.has(dados.domain)) return "domínio na lista de supressão";
  if (dados.sourceRef && listas.source_ref.has(dados.sourceRef)) return "estabelecimento na lista de supressão";
  return null;
}
