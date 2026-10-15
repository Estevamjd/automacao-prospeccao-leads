/**
 * Extracao de sinais a partir das tags do OpenStreetMap.
 *
 * O projeto original guardava as tags cruas em raw_data e usava apenas name,
 * website, phone e a categoria. As tags do OSM trazem muito mais: se entrega,
 * se aceita cartao, horario de funcionamento, tipo de cozinha, redes sociais.
 * E disso que o consultor tira as recomendacoes - sem esses sinais, qualquer
 * sugestao seria generica.
 */

export type Signals = Record<string, boolean | string | number | null>;

/** Tags que indicam presenca digital. */
const WEBSITE_KEYS = ["website", "contact:website", "url", "website:menu"];
const PHONE_KEYS = ["phone", "contact:phone", "contact:mobile", "mobile"];
const EMAIL_KEYS = ["email", "contact:email"];
const INSTAGRAM_KEYS = ["contact:instagram", "instagram"];
const FACEBOOK_KEYS = ["contact:facebook", "facebook"];
const WHATSAPP_KEYS = ["contact:whatsapp", "whatsapp"];

function firstValue(tags: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return null;
}

/** OSM usa "yes"/"no"/"only"/"limited". Normaliza para booleano ou null. */
function osmBool(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (["yes", "only", "designated", "true", "1"].includes(v)) return true;
  if (["no", "false", "0"].includes(v)) return false;
  if (v === "limited") return true;
  return null;
}

/**
 * Detecta se o estabelecimento parece ser de rede/franquia.
 * Importante comercialmente: rede raramente decide compra na ponta, entao
 * vale despriorizar em vez de gastar mensagem.
 */
function looksLikeChain(tags: Record<string, string>): boolean {
  if (tags["brand"] || tags["brand:wikidata"] || tags["operator:wikidata"]) return true;

  const nome = (tags["name"] ?? "").toLowerCase();
  const redesConhecidas = [
    "mcdonald", "burger king", "subway", "bob's", "bobs", "habib",
    "spoleto", "giraffas", "outback", "starbucks", "casa do pao de queijo",
    "cacau show", "kopenhagen", "smart fit", "smartfit", "bluefit",
    "drogaria", "drogasil", "pacheco", "raia", "extrafarma",
    "carrefour", "assai", "atacadao", "guanabara", "prezunic", "mundial",
  ];
  return redesConhecidas.some((rede) => nome.includes(rede));
}

/** Aproxima "abre no fim de semana" a partir de opening_hours. */
function abreFimDeSemana(openingHours: string | undefined): boolean | null {
  if (!openingHours) return null;
  const oh = openingHours.toLowerCase();
  if (oh.includes("24/7")) return true;
  return /\b(sa|su|sat|sun)\b/.test(oh);
}

export function extractSignals(tags: Record<string, string> = {}): Signals {
  const website = firstValue(tags, WEBSITE_KEYS);
  const phone = firstValue(tags, PHONE_KEYS);
  const email = firstValue(tags, EMAIL_KEYS);
  const instagram = firstValue(tags, INSTAGRAM_KEYS);
  const facebook = firstValue(tags, FACEBOOK_KEYS);
  const whatsapp = firstValue(tags, WHATSAPP_KEYS);
  const openingHours = tags["opening_hours"];

  const temEndereco = Boolean(tags["addr:street"] || tags["addr:housenumber"]);

  const aceitaCartao =
    osmBool(tags["payment:cards"]) ??
    osmBool(tags["payment:credit_cards"]) ??
    osmBool(tags["payment:debit_cards"]);

  return {
    // --- presenca digital ---
    has_website: Boolean(website),
    has_phone: Boolean(phone),
    has_email: Boolean(email),
    has_instagram: Boolean(instagram),
    has_facebook: Boolean(facebook),
    has_whatsapp: Boolean(whatsapp),
    has_social: Boolean(instagram || facebook),
    has_any_contact: Boolean(phone || email || whatsapp),

    // --- operacao ---
    has_opening_hours: Boolean(openingHours),
    opens_weekend: abreFimDeSemana(openingHours),
    open_24_7: openingHours?.includes("24/7") ?? false,
    has_delivery: osmBool(tags["delivery"]),
    has_takeaway: osmBool(tags["takeaway"]),
    has_outdoor_seating: osmBool(tags["outdoor_seating"]),
    has_reservation: osmBool(tags["reservation"]),
    accepts_cards: aceitaCartao,
    accepts_pix: osmBool(tags["payment:pix"]),
    has_air_conditioning: osmBool(tags["air_conditioning"]),
    wheelchair_accessible: osmBool(tags["wheelchair"]),

    // --- identidade ---
    has_address: temEndereco,
    is_chain: looksLikeChain(tags),
    cuisine: tags["cuisine"] ?? null,
    brand: tags["brand"] ?? null,

    // --- qualidade do registro ---
    // Quantas tags uteis o estabelecimento tem. Cadastro pobre no OSM costuma
    // andar junto com presenca digital fraca - que e justamente a oportunidade.
    tag_richness: Object.keys(tags).length,
  };
}

/**
 * Numero de 0 a 1 dizendo o quanto confiamos no diagnostico.
 * Com pouquissima informacao, o consultor deve admitir que esta chutando em vez
 * de fingir certeza - foi o erro que a versao anterior cometia ao devolver
 * sempre confidence_score 0.65 fixo.
 */
export function confidenceFromSignals(signals: Signals): number {
  const informativos = [
    "has_website", "has_phone", "has_instagram", "has_opening_hours",
    "has_delivery", "accepts_cards", "has_address",
  ];

  const conhecidos = informativos.filter((chave) => {
    const valor = signals[chave];
    return valor !== null && valor !== undefined;
  }).length;

  const riqueza = Number(signals.tag_richness ?? 0);
  const bonusRiqueza = Math.min(0.2, riqueza / 100);

  // Piso de 0.25: nunca afirmamos ter certeza total, nunca dizemos zero.
  return Math.min(0.9, Math.max(0.25, (conhecidos / informativos.length) * 0.7 + bonusRiqueza));
}
