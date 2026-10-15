/**
 * Pontuacao por regras lidas do BANCO.
 *
 * Corrige o achado G5: a tabela rule_sets existia, era populada pelo seed e
 * documentada - e o rules-runner ignorava tudo, com os pesos fixos no
 * TypeScript. Aqui as regras sao lidas de verdade; nao ha peso duplicado.
 */

export type Regra = {
  field: string;
  operator: "present" | "absent" | "contains_any" | "equals" | "gte" | "lte" | "in" | "between";
  values?: string[];
  value?: string | number;
  range?: [number, number];
  bloqueia?: boolean;
  points: number;
  reason?: string;
};

export type ResultadoScore = {
  score: number;
  motivos: string[];
  regras_aplicadas: number;
  bloqueada: boolean;
};

function valorDoCampo(alvo: Record<string, unknown>, campo: string): unknown {
  // Aceita "signals.has_website" alem de campo direto da empresa.
  if (campo.includes(".")) {
    const [raiz, chave] = campo.split(".");
    const objeto = alvo[raiz];
    if (objeto && typeof objeto === "object") {
      return (objeto as Record<string, unknown>)[chave];
    }
    return undefined;
  }
  return alvo[campo];
}

function presente(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "string") return valor.trim().length > 0;
  if (typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

function semAcento(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Dados derivados usados pelas regras v3; ausencia de fonte continua desconhecida. */
export function prepararEmpresaParaRegras(empresa: Record<string, unknown>): Record<string, unknown> {
  const metadata = (empresa.metadata ?? {}) as Record<string, unknown>;
  const sinais = (empresa.signals ?? {}) as Record<string, unknown>;
  const conferidos = (empresa.manual_overrides ?? {}) as Record<string, unknown>;
  const siteConferido = conferidos.website_url && typeof conferidos.website_url === "object" &&
    "confirmed_at" in conferidos.website_url;
  const inicio = empresa.aberta_em ?? metadata.inicio_atividade;
  let meses: number | null = null;
  if (typeof inicio === "string" && /^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
    const data = new Date(`${inicio}T12:00:00Z`);
    if (!Number.isNaN(data.getTime()) && data.getTime() <= Date.now()) {
      const hoje = new Date();
      meses = (hoje.getUTCFullYear() - data.getUTCFullYear()) * 12 + hoje.getUTCMonth() - data.getUTCMonth();
      if (hoje.getUTCDate() < data.getUTCDate()) meses -= 1;
    }
  }
  return {
    ...empresa,
    site_status: presente(empresa.website_url) ? "tem" : siteConferido ? "conferido_sem" : "nao_encontrado",
    tem_whatsapp: sinais.has_whatsapp === true,
    meses_aberta: meses,
    porte: empresa.porte ?? metadata.porte ?? null,
  };
}

export function validarRegra(bruto: unknown): Regra | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;

  const operadores = ["present", "absent", "contains_any", "equals", "gte", "lte", "in", "between"];
  if (typeof r.field !== "string" || !operadores.includes(String(r.operator))) return null;
  if (typeof r.points !== "number" || !Number.isFinite(r.points)) return null;
  if (r.operator === "between" && (!Array.isArray(r.range) || r.range.length !== 2 ||
      !r.range.every((x: unknown) => typeof x === "number" && Number.isFinite(x)) || r.range[0] > r.range[1])) return null;
  if (r.operator === "in" && (!Array.isArray(r.values) || !r.values.every((x: unknown) => typeof x === "string"))) return null;

  return {
    field: r.field,
    operator: r.operator as Regra["operator"],
    values: Array.isArray(r.values) ? (r.values as unknown[]).map(String) : undefined,
    value: (typeof r.value === "string" || typeof r.value === "number") ? r.value : undefined,
    range: r.operator === "between" ? r.range as [number, number] : undefined,
    bloqueia: r.bloqueia === true,
    points: Math.max(-100, Math.min(100, r.points)),
    reason: typeof r.reason === "string" ? r.reason : undefined,
  };
}

export function aplicarRegras(
  empresa: Record<string, unknown>,
  regras: Regra[],
  basePontos = 25,
): ResultadoScore {
  let score = basePontos;
  const motivos: string[] = [];
  let aplicadas = 0;
  let bloqueada = false;

  for (const regra of regras) {
    const valor = valorDoCampo(empresa, regra.field);
    let bate = false;

    switch (regra.operator) {
      case "present":
        bate = presente(valor);
        break;
      case "absent":
        bate = !presente(valor);
        break;
      case "contains_any": {
        const texto = semAcento(String(valor ?? ""));
        bate = (regra.values ?? []).some((termo) => texto.includes(semAcento(termo)));
        break;
      }
      case "equals":
        bate = String(valor ?? "") === String(regra.value ?? "");
        break;
      case "gte":
        bate = presente(valor) && Number.isFinite(Number(valor)) && Number(valor) >= Number(regra.value);
        break;
      case "lte":
        bate = presente(valor) && Number.isFinite(Number(valor)) && Number(valor) <= Number(regra.value);
        break;
      case "in":
        bate = presente(valor) && (regra.values ?? []).some(v => semAcento(v) === semAcento(String(valor)));
        break;
      case "between":
        bate = presente(valor) && Number.isFinite(Number(valor)) &&
          Number(valor) >= (regra.range?.[0] ?? Infinity) && Number(valor) <= (regra.range?.[1] ?? -Infinity);
        break;
    }

    if (bate) {
      score += regra.points;
      if (regra.bloqueia) bloqueada = true;
      aplicadas += 1;
      if (regra.reason) motivos.push(regra.reason.replace(/\{([a-z_]+)\}/g, (_, campo) =>
        String(valorDoCampo(empresa, campo) ?? '?')));
    }
  }

  return {
    score: bloqueada ? 0 : Math.max(0, Math.min(100, Math.round(score))),
    motivos,
    regras_aplicadas: aplicadas,
    bloqueada,
  };
}

/** Conjunto usado quando o workspace ainda nao tem rule_set cadastrado. */
export const REGRAS_PADRAO: Regra[] = [
  { field: "website_url", operator: "present", points: 15, reason: "Tem site" },
  { field: "main_phone", operator: "present", points: 15, reason: "Tem telefone" },
  { field: "main_email", operator: "present", points: 10, reason: "Tem e-mail" },
  { field: "city", operator: "present", points: 10, reason: "Tem localização" },
  { field: "signals.has_instagram", operator: "present", points: 10, reason: "Tem Instagram" },
  { field: "signals.has_opening_hours", operator: "present", points: 5, reason: "Divulga horário" },
  { field: "signals.is_chain", operator: "present", points: -25, reason: "Parece rede ou franquia" },
  {
    field: "category",
    operator: "contains_any",
    values: ["restaurante", "restaurant", "pizzaria", "clinica", "clinic", "academia", "fitness", "beauty", "hairdresser", "dentist", "veterinary", "car_repair", "bakery"],
    points: 20,
    reason: "Segmento prioritário",
  },
];
