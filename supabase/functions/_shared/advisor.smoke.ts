/**
 * Teste de fumaca do consultor com dados REAIS do OpenStreetMap.
 *
 * Nao e teste unitario: e uma checagem de sanidade que roda contra
 * estabelecimentos de verdade e imprime o que o consultor diria, para voce ler
 * e julgar se faz sentido. Bug de logica passa em teste unitario; recomendacao
 * sem pe nem cabeca so aparece lendo.
 *
 * Rodar buscando na hora:
 *   deno run --allow-net --allow-read advisor.smoke.ts --playbooks=playbooks.json
 *
 * Ou com um retorno do Overpass ja salvo (util quando a rede esta limitada
 * ou para repetir sempre com os mesmos dados):
 *   deno run --allow-read advisor.smoke.ts --playbooks=playbooks.json --osm=osm.json
 */

import { confidenceFromSignals, extractSignals } from "./signals.ts";
import { gerarBrief, validarPlaybook, type Playbook } from "./advisor.ts";

const BBOX_OLARIA = "-22.858,-43.274,-22.828,-43.242";

const QUERY = `[out:json][timeout:25];
(
  node["amenity"~"restaurant|fast_food|cafe|bar|pub|clinic|dentist|doctors|veterinary|pharmacy"](${BBOX_OLARIA});
  node["shop"~"bakery|hairdresser|beauty|convenience|supermarket|car_repair|pet"](${BBOX_OLARIA});
  node["leisure"~"fitness_centre|sports_centre"](${BBOX_OLARIA});
);
out tags center 60;`;

async function buscarOsm(): Promise<Array<{ type: string; id: number; tags: Record<string, string> }>> {
  const resposta = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "prospeccao-clientes/1.0 (teste de sanidade do consultor)",
    },
    body: new URLSearchParams({ data: QUERY }),
  });

  if (!resposta.ok) {
    throw new Error(`Overpass devolveu ${resposta.status}. Provavelmente limite de uso; tente de novo em alguns minutos.`);
  }

  const dados = await resposta.json();
  return dados.elements ?? [];
}

function carregarPlaybooks(caminho: string): Playbook[] {
  const bruto = JSON.parse(Deno.readTextFileSync(caminho));
  return (Array.isArray(bruto) ? bruto : []).map(validarPlaybook).filter((p): p is Playbook => p !== null);
}

function linha(char = "-") {
  console.log(char.repeat(78));
}

if (import.meta.main) {
  const argPlaybooks = Deno.args.find((a) => a.startsWith("--playbooks="))?.split("=")[1];
  if (!argPlaybooks) {
    console.error("Uso: --playbooks=/caminho/playbooks.json");
    Deno.exit(1);
  }

  const playbooks = carregarPlaybooks(argPlaybooks);
  console.log(`${playbooks.length} playbooks carregados: ${playbooks.map((p) => p.slug).join(", ")}\n`);

  type ElementoOsm = { type: string; id: number; tags?: Record<string, string> };
  const argOsm = Deno.args.find((a) => a.startsWith("--osm="))?.split("=")[1];
  const elementos: ElementoOsm[] = argOsm
    ? ((JSON.parse(Deno.readTextFileSync(argOsm)).elements ?? []) as ElementoOsm[])
    : await buscarOsm();
  const comNome = elementos.filter((e) => Boolean(e.tags?.name));
  console.log(`${comNome.length} estabelecimentos com nome encontrados em Olaria/RJ\n`);

  // Estatisticas para julgar a qualidade da fonte, nao so do consultor.
  let comPlaybook = 0;
  let comTelefone = 0;
  let comSite = 0;
  let redes = 0;
  const porSegmento = new Map<string, number>();

  const amostra: string[] = [];

  for (const elemento of comNome) {
    const tags = elemento.tags ?? {};
    const signals = extractSignals(tags);
    const confianca = confidenceFromSignals(signals);

    const empresa = {
      name: tags.name,
      category: tags.amenity ?? tags.shop ?? tags.leisure ?? tags.healthcare ?? null,
      city: "Rio de Janeiro",
      signals,
    };

    const brief = gerarBrief(empresa, playbooks, confianca);

    if (brief.playbook_slug) comPlaybook += 1;
    if (signals.has_phone) comTelefone += 1;
    if (signals.has_website) comSite += 1;
    if (signals.is_chain) redes += 1;
    porSegmento.set(brief.segmento, (porSegmento.get(brief.segmento) ?? 0) + 1);

    if (amostra.length < 8) {
      const partes = [
        `EMPRESA:   ${empresa.name}  [${empresa.category}]`,
        `SEGMENTO:  ${brief.segmento}   confiança ${brief.confianca}`,
        `AMIGO:     ${brief.resumo_amigo}`,
        `PROPOR:    ${brief.oferta_principal?.titulo ?? "(nada)"}` +
          (brief.oferta_principal?.faixa_preco ? `  (${brief.oferta_principal.faixa_preco})` : ""),
        `ABERTURA:  ${brief.abertura}`,
        `PRÓXIMO:   ${brief.proximo_passo}`,
      ];
      amostra.push(partes.join("\n"));
    }
  }

  linha("=");
  console.log("AMOSTRA DO QUE O CONSULTOR DIRIA");
  linha("=");
  for (const bloco of amostra) {
    console.log(bloco);
    linha();
  }

  linha("=");
  console.log("ESTATÍSTICAS DA FONTE (o que dá pra esperar do OSM em Olaria)");
  linha("=");
  console.log(`estabelecimentos com nome ......... ${comNome.length}`);
  console.log(`com playbook de nicho específico .. ${comPlaybook} (${pct(comPlaybook, comNome.length)})`);
  console.log(`com telefone publicado ............ ${comTelefone} (${pct(comTelefone, comNome.length)})`);
  console.log(`com site .......................... ${comSite} (${pct(comSite, comNome.length)})`);
  console.log(`identificados como rede/franquia .. ${redes} (${pct(redes, comNome.length)})`);
  console.log("\ndistribuição por segmento:");
  for (const [seg, n] of [...porSegmento.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${seg}`);
  }
}

function pct(parte: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((parte / total) * 100)}%`;
}
