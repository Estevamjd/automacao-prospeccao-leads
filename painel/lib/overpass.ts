/**
 * Busca no mapa (OpenStreetMap, via Overpass), v2 de 29/09/2026.
 *
 * O que mudou em relação à v1:
 *  - a área é o limite oficial do lugar (estado, município, bairro/distrito),
 *    não mais um retângulo fixo do Rio. Serve para RJ e SP inteiros e para
 *    qualquer UF no futuro;
 *  - o segmento usa as MESMAS chaves do cadastro de CNPJ (lib/geografia.ts),
 *    para as duas fontes se juntarem na mesma empresa;
 *  - só volta quem tem algum contato (telefone, WhatsApp, e-mail, site ou
 *    Instagram). No mapa, 9 em cada 10 lugares não têm nenhum: trazê-los só
 *    enchia a base de empresas impossíveis de abordar;
 *  - o resultado já sai no formato de mesclar_empresa (banco), que decide se é
 *    empresa nova ou se completa uma que já existe.
 *
 * Mantido da v1: timeout do cliente maior que o do servidor, User-Agent com
 * contato (política do Overpass), retentativa com espera em 429/5xx e
 * nenhuma consulta em paralelo (o servidor público é compartilhado).
 */
import { BAIRROS_DA_ZONA, semAcento } from '@/lib/geografia';

export type Alvo = {
  uf: string;
  municipio?: string | null;
  zona?: string | null;
  bairros?: string[] | null;
};

/** Formato aceito por ingerir_do_mapa / mesclar_empresa no banco. */
export type LeadMapa = {
  source_ref: string;
  name: string;
  telefones: string[];
  main_email?: string;
  website_url?: string;
  instagram_url?: string;
  address_line?: string;
  cep?: string;
  city?: string;
  state: string;
  category?: string;
  lat?: number;
  lon?: number;
  data_source_url: string;
  metadata: Record<string, unknown>;
  signals: Record<string, boolean | string | null>;
};

/** Segmento (mesmas chaves do CNPJ) -> filtros de tag do OpenStreetMap. */
export const FILTROS_MAPA: Record<string, string[]> = {
  beleza: ['["shop"~"^(hairdresser|beauty|barber|nails|massage)$"]'],
  barbearia: ['["shop"="barber"]', '["hairdresser"="barber"]', '["shop"="hairdresser"]["name"~"barbearia|barber|barbeiro",i]'],
  manicure: ['["shop"="nails"]', '["beauty"="nails"]', '["shop"="beauty"]["name"~"manicure|nail|unha",i]'],
  estetica: ['["shop"~"^(beauty|massage)$"]', '["amenity"="spa"]'],
  sorveteria: ['["amenity"="ice_cream"]', '["shop"="ice_cream"]', '["amenity"="cafe"]["name"~"sorvete|açaí|acai|gelato",i]'],
  petshop: ['["shop"~"^(pet|pet_grooming)$"]', '["amenity"="veterinary"]'],
  academia: ['["leisure"="fitness_centre"]', '["sport"~"^(yoga|pilates|crossfit)$"]["leisure"]'],
  odonto: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
  clinica: ['["amenity"~"^(clinic|doctors)$"]', '["healthcare"~"^(clinic|doctor|physiotherapist|psychotherapist)$"]'],
  restaurante: ['["amenity"="restaurant"]["cuisine"!~"pizza"]'],
  pizzaria: ['["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"pizza"]'],
  lanchonete: ['["amenity"="fast_food"]["cuisine"!~"pizza"]', '["amenity"~"^(cafe|ice_cream)$"]'],
  bar: ['["amenity"~"^(bar|pub|biergarten)$"]'],
  padaria: ['["shop"~"^(bakery|pastry|confectionery)$"]'],
  oficina: ['["shop"~"^(car_repair|tyres)$"]', '["craft"="car_repair"]'],
  mercado: ['["shop"~"^(convenience|supermarket|butcher|greengrocer)$"]'],
  educacao: ['["amenity"~"^(language_school|music_school|driving_school|prep_school)$"]'],
};

export function filtrosDoCatalogo(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.slice(0, 20).flatMap((item): string[] => {
    if (!item || typeof item !== 'object') return [];
    const { chave, valores } = item as { chave?: unknown; valores?: unknown };
    if (typeof chave !== 'string' || !/^[a-z0-9:_-]{1,40}$/.test(chave) || !Array.isArray(valores)) return [];
    const seguros = valores.filter((v): v is string => typeof v === 'string' && /^[a-z0-9:_ -]{1,60}$/.test(v)).slice(0, 20);
    return seguros.length ? [`["${chave}"~"^(${seguros.join('|')})$",i]`] : [];
  });
}

const CHAVES_CONTATO = ['phone', 'contact:phone', 'mobile', 'contact:mobile', 'whatsapp', 'contact:whatsapp',
  'email', 'contact:email', 'website', 'contact:website', 'instagram', 'contact:instagram'];

const ENDPOINTS = (process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter')
  .split(',').map(u => u.trim()).filter(u => /^https:\/\//.test(u));
const TIMEOUT_SERVIDOR = 110;      // segundos, dentro da consulta
const TIMEOUT_CLIENTE = 125_000;   // ms, maior que o do servidor de propósito

const VARIANTES: Record<string, string[]> = {
  a: ['a', 'á', 'à', 'â', 'ã', 'Á', 'À', 'Â', 'Ã'],
  e: ['e', 'é', 'ê', 'É', 'Ê'],
  i: ['i', 'í', 'Í'],
  o: ['o', 'ó', 'ô', 'õ', 'Ó', 'Ô', 'Õ'],
  u: ['u', 'ú', 'ü', 'Ú', 'Ü'],
  c: ['c', 'ç', 'Ç'],
};

/**
 * Nome -> expressão que aceita com e sem acento: "Meier" acha "Méier",
 * "Sao Goncalo" acha "São Gonçalo". O Overpass compara bytes, então a
 * alternância explícita (a|á|...) é o que funciona com UTF-8.
 * Qualquer caractere fora de letra/número/espaço vira "." (evita injetar
 * sintaxe na consulta).
 */
export function regexTolerante(nome: string): string {
  const base = semAcento(nome).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  return [...base].map((ch) => {
    if (VARIANTES[ch]) return `(${VARIANTES[ch].join('|')})`;
    if (/[a-z0-9]/.test(ch)) return ch;
    if (ch === ' ' || ch === '-') return '[ -]';
    return '.';
  }).join('');
}

export function montarConsulta(alvo: Alvo, segmento: string, limite: number, filtrosCatalogo?: string[]): string {
  const filtros = filtrosCatalogo?.length ? filtrosCatalogo : FILTROS_MAPA[segmento];
  if (!filtros) throw new Error('Segmento desconhecido.');
  if (!/^[A-Z]{2}$/.test(alvo.uf)) throw new Error('UF inválida.');

  const linhas = [`[out:json][timeout:${TIMEOUT_SERVIDOR}];`, `area["ISO3166-2"="BR-${alvo.uf}"]->.uf;`];
  let area = 'uf';

  if (alvo.municipio) {
    linhas.push(`rel["boundary"="administrative"]["admin_level"="8"]["name"~"^${regexTolerante(alvo.municipio)}$",i](area.uf);`);
    linhas.push('map_to_area->.mun;');
    area = 'mun';

    // Zona e bairros viram os limites de bairro (Rio, nível 10) ou distrito (SP, nível 9).
    const bairros = alvo.bairros?.length
      ? alvo.bairros
      : alvo.zona ? BAIRROS_DA_ZONA[alvo.uf]?.[alvo.zona] ?? [] : [];
    if (bairros.length) {
      const nomes = bairros.slice(0, 120).map(regexTolerante).join('|');
      linhas.push(`rel["boundary"="administrative"]["admin_level"~"^(9|10)$"]["name"~"^(${nomes})$",i](area.mun);`);
      linhas.push('map_to_area->.bai;');
      area = 'bai';
    }
  }

  const temContato = CHAVES_CONTATO.map(k => `is_tag("${k}")`).join(' || ');
  linhas.push('(');
  for (const f of filtros) {
    const recorte = segmento === 'restaurante' || segmento === 'lanchonete' ? '["cuisine"!~"pizza",i]'
      : segmento === 'pizzaria' ? '["amenity"~"^(restaurant|fast_food)$"]' : '';
    linhas.push(`  nwr${f}${recorte}["name"](area.${area})(if: ${temContato});`);
  }
  linhas.push(');');
  linhas.push(`out tags center ${Math.max(1, Math.min(Math.floor(limite), 1000))};`);
  return linhas.join('\n');
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function consultar(consulta: string): Promise<{ elements?: unknown[] }> {
  let ultimoErro = '';
  // Cada servidor tem 2 tentativas; se o primeiro estiver fora, passa ao próximo.
  for (const endpoint of ENDPOINTS) {
    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      const controle = new AbortController();
      const relogio = setTimeout(() => controle.abort(), TIMEOUT_CLIENTE);
      try {
        const resposta = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            // A política de uso do Overpass pede identificação de quem chama.
            'User-Agent': `prospeccao-clientes/2.0 (${process.env.CONTATO_EMAIL ?? 'sem-contato'})`,
          },
          body: new URLSearchParams({ data: consulta }),
          signal: controle.signal,
          cache: 'no-store',
        });
        if (resposta.ok) return await resposta.json();
        ultimoErro = `HTTP ${resposta.status}`;
        // 400 = consulta com erro: repetir não resolve.
        if (resposta.status === 400) throw new Error('Consulta ao mapa recusada (400).');
      } catch (erro) {
        ultimoErro = erro instanceof Error ? erro.message : String(erro);
        if (ultimoErro.includes('(400)')) throw erro;
      } finally {
        clearTimeout(relogio);
      }
      await esperar(tentativa * 5000);
    }
  }
  throw new Error(`O mapa (OpenStreetMap) não respondeu agora (${ultimoErro}).`);
}

const limpo = (v?: string) => (v && v.trim() ? v.trim() : undefined);

/** Valores do OSM podem vir juntos: "+55 21 2222-3333; +55 21 99999-8888". */
function varios(tags: Record<string, string>, chaves: string[], separador: RegExp = /;/): string[] {
  return chaves.flatMap(k => (tags[k] ?? '').split(separador)).map(v => v.trim()).filter(Boolean);
}
/** Telefone também aparece separado por vírgula ou barra; site e e-mail, só por ";". */
const SEP_FONE = /[;,/]/;

function osmBool(valor?: string): boolean | null {
  if (valor === undefined) return null;
  const v = valor.trim().toLowerCase();
  if (['yes', 'only', 'designated', 'limited', 'true', '1'].includes(v)) return true;
  if (['no', 'false', '0'].includes(v)) return false;
  return null;
}

function instagramDe(tags: Record<string, string>, sites: string[]): string | undefined {
  const bruto = limpo(tags['contact:instagram']) ?? limpo(tags.instagram) ?? sites.find(s => /instagram\.com\//i.test(s));
  if (!bruto) return undefined;
  if (/^https?:\/\//i.test(bruto)) return bruto.slice(0, 300);
  const usuario = bruto.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  return usuario ? `https://www.instagram.com/${usuario}` : undefined;
}

/** Elemento do Overpass -> dados para o banco. Null quando não serve. */
export function paraLead(bruto: unknown, alvo: Alvo, segmento: string): LeadMapa | null {
  const el = bruto as { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
  const tags = el.tags ?? {};
  const nome = limpo(tags.name);
  if (!nome || nome.length > 200 || !['node', 'way', 'relation'].includes(el.type)) return null;
  // Rede/franquia tem marketing próprio: não é o nosso cliente.
  if (tags.brand || tags['brand:wikidata'] || tags['operator:wikidata']) return null;

  const whatsapp = varios(tags, ['whatsapp', 'contact:whatsapp'], SEP_FONE);
  const telefones = [...varios(tags, ['mobile', 'contact:mobile'], SEP_FONE), ...whatsapp, ...varios(tags, ['phone', 'contact:phone'], SEP_FONE)]
    .map(t => t.replace(/[^\d+]/g, '')).filter(t => t.replace(/\D/g, '').length >= 10).slice(0, 5);
  const sites = varios(tags, ['website', 'contact:website', 'url']);
  const site = sites.find(s => !/instagram\.com|facebook\.com|wa\.me|whatsapp\.com/i.test(s));
  const instagram = instagramDe(tags, sites);
  const email = varios(tags, ['email', 'contact:email']).map(e => e.toLowerCase())
    .find(e => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && e.length <= 120);
  if (!telefones.length && !email && !site && !instagram) return null;

  const rua = limpo(tags['addr:street']);
  const numero = limpo(tags['addr:housenumber']);
  const bairro = limpo(tags['addr:suburb']) ?? limpo(tags['addr:neighbourhood']);
  const cep = (tags['addr:postcode'] ?? '').replace(/\D/g, '');
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const categoria = limpo(tags.amenity) ?? limpo(tags.shop) ?? limpo(tags.healthcare) ?? limpo(tags.leisure) ?? limpo(tags.craft);
  const horario = limpo(tags.opening_hours);

  return {
    source_ref: `osm:${el.type}/${el.id}`,
    name: nome,
    telefones,
    main_email: email,
    website_url: site?.slice(0, 300),
    instagram_url: instagram,
    address_line: [rua && numero ? `${rua}, ${numero}` : rua, bairro].filter(Boolean).join(' - ') || undefined,
    cep: cep.length === 8 ? cep : undefined,
    city: alvo.municipio ?? limpo(tags['addr:city']),
    state: alvo.uf,
    category: categoria,
    lat, lon,
    data_source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    // Minimização: só o que a abordagem usa, nunca as tags cruas inteiras.
    metadata: {
      segmento, uf: alvo.uf, zona: alvo.zona ?? null, bairro: bairro ?? null,
      horario: horario ?? null, cozinha: limpo(tags.cuisine) ?? null,
    },
    signals: {
      has_whatsapp: whatsapp.length > 0 || null,
      has_opening_hours: Boolean(horario),
      opens_weekend: horario ? /\b(sa|su)\b|24\/7/i.test(horario) : null,
      has_delivery: osmBool(tags.delivery),
      has_takeaway: osmBool(tags.takeaway),
      has_reservation: osmBool(tags.reservation),
      has_address: Boolean(rua || numero),
      has_facebook: Boolean(tags['contact:facebook'] || tags.facebook || sites.some(s => /facebook\.com/i.test(s))),
      cuisine: limpo(tags.cuisine) ?? null,
    },
  };
}

export async function buscarNoMapa(alvo: Alvo, segmento: string, limite = 300, filtrosCatalogo?: string[]): Promise<{ leads: LeadMapa[]; brutos: number }> {
  const dados = await consultar(montarConsulta(alvo, segmento, limite, filtrosCatalogo));
  const vistos = new Set<string>();
  const leads: LeadMapa[] = [];
  for (const bruto of dados.elements ?? []) {
    const lead = paraLead(bruto, alvo, segmento);
    if (!lead || vistos.has(lead.source_ref)) continue;
    vistos.add(lead.source_ref);
    // Sinal desconhecido (null) não vai: o banco guardaria "não sei" como dado.
    for (const [k, v] of Object.entries(lead.signals)) if (v === null) delete lead.signals[k];
    leads.push(lead);
  }
  return { leads, brutos: (dados.elements ?? []).length };
}
