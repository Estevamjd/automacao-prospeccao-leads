/**
 * Testes do motor consultor e da extracao de sinais.
 * Rodar com:  deno test --allow-read supabase/functions/_shared/
 */

import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import { confidenceFromSignals, extractSignals } from "./signals.ts";
import {
  AVISO_ORIGEM_CADASTRO,
  avaliarCondicao,
  escolherPlaybook,
  gerarBrief,
  origemDe,
  PLAYBOOK_GENERICO,
  sinaisConfiaveisParaConsultoria,
  validarPlaybook,
  type Playbook,
} from "./advisor.ts";

Deno.test("ausência nas fontes não vira afirmação de que não há site", () => {
  const sinais = sinaisConfiaveisParaConsultoria({ has_website: false, has_instagram: false, has_phone: true });
  assertEquals(sinais.has_website, null);
  assertEquals(sinais.has_instagram, null);
  assertEquals(sinais.has_phone, true);
  assertEquals(avaliarCondicao({ sem: ["has_website"] }, sinais), false);
});

// -----------------------------------------------------------------------------
// Playbooks de teste, no mesmo formato que vem do banco
// -----------------------------------------------------------------------------

const PIZZARIA: Playbook = {
  slug: "pizzaria",
  label: "Pizzaria",
  match_terms: ["pizzaria", "pizza"],
  weight: 80,
  pains: [
    {
      codigo: "sem_pedido_online",
      texto: "Não tem canal de pedido próprio.",
      gravidade: "alta",
      quando: { sem: ["has_website"] },
    },
    {
      codigo: "pico_fds",
      texto: "O movimento concentra no fim de semana.",
      gravidade: "media",
      quando: { com: ["opens_weekend"] },
    },
  ],
  offers: [
    {
      codigo: "cardapio_whatsapp",
      titulo: "Cardápio digital com pedido no WhatsApp",
      porque: "tira a comissão do aplicativo",
      pitch: "pensei num cardápio digital pra receber pedido direto.",
      esforco: "baixo",
      impacto: "alto",
      resolve: ["sem_pedido_online"],
    },
    {
      codigo: "app_proprio",
      titulo: "Aplicativo próprio",
      porque: "controle total do canal",
      pitch: "dá pra fazer um app da pizzaria.",
      esforco: "alto",
      impacto: "alto",
      resolve: [],
    },
  ],
  opening_questions: ["Hoje a maior parte dos pedidos vem por aplicativo?"],
  avoid: ["Não criticar o iFood de cara."],
};

const RESTAURANTE: Playbook = {
  slug: "restaurante",
  label: "Restaurante",
  match_terms: ["restaurante", "restaurant"],
  weight: 60,
  pains: [
    {
      codigo: "sem_site",
      texto: "Não tem site.",
      gravidade: "alta",
      quando: { sem: ["has_website"] },
    },
  ],
  offers: [
    {
      codigo: "presenca_google",
      titulo: "Google Meu Negócio",
      porque: "é o primeiro lugar onde procuram",
      pitch: "dá pra melhorar como vocês aparecem no Google.",
      esforco: "baixo",
      impacto: "alto",
      resolve: ["sem_site"],
    },
  ],
  opening_questions: ["O movimento é mais no almoço ou à noite?"],
  avoid: [],
};

const TODOS = [PIZZARIA, RESTAURANTE];

Deno.test("segmento nao confunde petisco com pet nem barbearia com bar", () => {
  const pet = { ...RESTAURANTE, slug: 'pet', match_terms: ['pet'] };
  const bar = { ...RESTAURANTE, slug: 'bar', match_terms: ['bar'] };
  assertEquals(escolherPlaybook({ name: 'Petisco da Vila', category: 'restaurant', signals: {} }, [pet, RESTAURANTE])?.slug, 'restaurante');
  assertEquals(escolherPlaybook({ name: 'Barbearia Carioca', category: null, signals: {} }, [bar]), null);
  assertEquals(escolherPlaybook({ name: 'Pet Shop Central', category: null, signals: {} }, [pet])?.slug, 'pet');
});

Deno.test("nicho confirmado no banco escolhe playbook mesmo sem match_terms", () => {
  const sorveteria = { ...RESTAURANTE, slug: 'sorveteria', match_terms: [] };
  assertEquals(escolherPlaybook({ name: 'Gelato de Olaria', nicho: 'sorveteria', category: 'ice_cream', signals: {} },
    [RESTAURANTE, sorveteria])?.slug, 'sorveteria');
  assertEquals(escolherPlaybook({ name: 'Outro local', nicho: 'inexistente', category: 'restaurant', signals: {} },
    [RESTAURANTE])?.slug, 'restaurante');
});

Deno.test("cadastro incompleto produz hipoteses e nao promessa de venda", () => {
  const brief = gerarBrief({ name: 'Negocio de teste', signals: {} }, [], 0.3);
  assertEquals(brief.diagnostico.length, 0);
  assert(brief.resumo_amigo.includes('Dados insuficientes'));
  assert(!brief.resumo_amigo.includes('fácil de fechar'));
});

// -----------------------------------------------------------------------------
// Extracao de sinais
// -----------------------------------------------------------------------------

Deno.test("sinais: detecta presenca digital a partir das tags do OSM", () => {
  const s = extractSignals({
    name: "Pizzaria Forno Alto",
    amenity: "restaurant",
    "contact:website": "https://fornoalto.com.br",
    phone: "+55 21 99999-8888",
    "contact:instagram": "@fornoalto",
    opening_hours: "Tu-Su 18:00-23:00",
    delivery: "yes",
    "payment:cards": "yes",
  });

  assertEquals(s.has_website, true);
  assertEquals(s.has_phone, true);
  assertEquals(s.has_instagram, true);
  assertEquals(s.has_social, true);
  assertEquals(s.has_opening_hours, true);
  assertEquals(s.has_delivery, true);
  assertEquals(s.accepts_cards, true);
  assertEquals(s.opens_weekend, true);
});

Deno.test("sinais: distingue 'nao tem' de 'nao sabemos'", () => {
  // delivery=no e uma afirmacao: NAO entrega.
  assertEquals(extractSignals({ delivery: "no" }).has_delivery, false);
  // ausencia da tag e desconhecimento, nao negacao.
  assertEquals(extractSignals({}).has_delivery, null);
});

Deno.test("sinais: identifica rede e franquia", () => {
  assertEquals(extractSignals({ name: "Bob's Olaria" }).is_chain, true);
  assertEquals(extractSignals({ name: "Subway", brand: "Subway" }).is_chain, true);
  assertEquals(extractSignals({ name: "Pizzaria do Zé" }).is_chain, false);
});

Deno.test("sinais: confianca sobe com cadastro mais rico", () => {
  const pobre = extractSignals({ name: "Bar do João" });
  const rico = extractSignals({
    name: "Bar do João",
    website: "https://x.com",
    phone: "21999998888",
    "contact:instagram": "@bar",
    opening_hours: "Mo-Sa 17:00-01:00",
    delivery: "no",
    "payment:cards": "yes",
    "addr:street": "Rua X",
    "addr:housenumber": "10",
  });

  assert(confidenceFromSignals(rico) > confidenceFromSignals(pobre));
  assert(confidenceFromSignals(pobre) >= 0.25, "nunca devolve confianca zero");
  assert(confidenceFromSignals(rico) <= 0.9, "nunca finge certeza total");
});

// -----------------------------------------------------------------------------
// Condicoes
// -----------------------------------------------------------------------------

Deno.test("condicao: com / sem / qualquer", () => {
  const sinais = { has_website: true, has_phone: false, has_instagram: true };

  assert(avaliarCondicao({ com: ["has_website"] }, sinais));
  assert(!avaliarCondicao({ com: ["has_phone"] }, sinais));
  assert(avaliarCondicao({ sem: ["has_phone"] }, sinais));
  assert(!avaliarCondicao({ sem: ["has_website"] }, sinais));
  assert(avaliarCondicao({ qualquer: ["has_phone", "has_instagram"] }, sinais));
  assert(!avaliarCondicao({ qualquer: ["has_phone"] }, sinais));
  assert(avaliarCondicao(undefined, sinais), "sem condicao sempre aplica");
});

Deno.test("condicao: sinal desconhecido não prova ausência", () => {
  const sinais = { has_delivery: null };
  assert(!avaliarCondicao({ sem: ["has_delivery"] }, sinais));
  assert(!avaliarCondicao({ com: ["has_delivery"] }, sinais));
  assert(!avaliarCondicao({ sem: ["sinal_que_nao_existe"] }, sinais));
});

// -----------------------------------------------------------------------------
// Escolha de playbook
// -----------------------------------------------------------------------------

Deno.test("playbook: termo mais especifico ganha do mais generico", () => {
  const escolhido = escolherPlaybook(
    { name: "Pizzaria Forno Alto", category: "restaurant", signals: {} },
    TODOS,
  );
  assertEquals(escolhido?.slug, "pizzaria", "pizzaria deve ganhar de restaurante");
});

Deno.test("playbook: casa por nome quando a categoria e generica", () => {
  const escolhido = escolherPlaybook(
    { name: "Cantina da Pizza", category: "fast_food", signals: {} },
    TODOS,
  );
  assertEquals(escolhido?.slug, "pizzaria");
});

Deno.test("playbook: acento nao atrapalha o casamento", () => {
  const comAcento = escolherPlaybook(
    { name: "Restaurante Sabor Único", category: "Restaurante Típico", signals: {} },
    TODOS,
  );
  assertEquals(comAcento?.slug, "restaurante");
});

Deno.test("playbook: sem correspondencia devolve null e o motor cai no generico", () => {
  assertEquals(
    escolherPlaybook({ name: "Cartório do Centro", category: "office", signals: {} }, TODOS),
    null,
  );

  const brief = gerarBrief(
    { name: "Cartório do Centro", category: "office", signals: { has_website: false } },
    TODOS,
    0.5,
  );
  assertEquals(brief.playbook_slug, null);
  assertEquals(brief.segmento, PLAYBOOK_GENERICO.label);
  assertExists(brief.oferta_principal, "mesmo no generico precisa sugerir algo");
});

// -----------------------------------------------------------------------------
// Geracao do parecer
// -----------------------------------------------------------------------------

Deno.test("brief: so lista as dores que realmente se aplicam", () => {
  const semSite = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: { has_website: false, opens_weekend: false } },
    TODOS,
    0.6,
  );
  const codigos = semSite.diagnostico.map((d) => d.codigo);
  assert(codigos.includes("sem_pedido_online"));
  assert(!codigos.includes("pico_fds"), "nao pode inventar dor que nao se aplica");

  const comSite = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: { has_website: true, opens_weekend: true } },
    TODOS,
    0.6,
  );
  const codigos2 = comSite.diagnostico.map((d) => d.codigo);
  assert(!codigos2.includes("sem_pedido_online"), "quem tem site nao tem essa dor");
  assert(codigos2.includes("pico_fds"));
});

Deno.test("brief: prioriza a oferta facil que resolve a dor detectada", () => {
  const brief = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: { has_website: false } },
    TODOS,
    0.6,
  );
  assertEquals(
    brief.oferta_principal?.codigo,
    "cardapio_whatsapp",
    "deve começar pela proposta barata que resolve a dor real, não pelo app caro",
  );
  assertEquals(brief.alternativas[0]?.codigo, "app_proprio");
});

Deno.test("brief: rede/franquia e despriorizada com confianca baixa", () => {
  const brief = gerarBrief(
    { name: "Bob's Olaria", category: "fast_food", signals: { is_chain: true, has_website: false } },
    TODOS,
    0.8,
  );
  assert(brief.confianca <= 0.35, "confiança precisa cair quando é rede");
  assert(
    brief.proximo_passo.toLowerCase().includes("rede") ||
      brief.proximo_passo.toLowerCase().includes("franquia"),
    "o próximo passo precisa avisar que é rede",
  );
});

Deno.test("brief: com pouca informacao, o texto admite que o palpite e fraco", () => {
  const brief = gerarBrief(
    { name: "Lugar Desconhecido", category: "pizzaria", signals: { has_website: false } },
    TODOS,
    0.3,
  );
  assert(
    brief.resumo_amigo.toLowerCase().includes("palpite") ||
      brief.resumo_amigo.toLowerCase().includes("pouca informação"),
    "com confiança baixa o consultor precisa avisar em vez de fingir certeza",
  );
});

Deno.test("brief: a abertura cita a empresa e termina com pergunta", () => {
  const brief = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: { has_website: false } },
    TODOS,
    0.6,
  );
  assert(brief.abertura.includes("Pizzaria Forno Alto"), "precisa citar o nome");
  assert(brief.abertura.trim().endsWith("?"), "precisa terminar com pergunta");
  assert(brief.abertura.length < 400, "mensagem de abertura precisa ser curta");
});

Deno.test("brief: repassa o que evitar falar com o nicho", () => {
  const brief = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: {} },
    TODOS,
    0.6,
  );
  assertEquals(brief.o_que_evitar, PIZZARIA.avoid);
});

Deno.test("brief: negocio sem buraco visivel nao inventa problema", () => {
  const brief = gerarBrief(
    {
      name: "Restaurante Completo",
      category: "restaurante",
      signals: { has_website: true, has_phone: true, has_instagram: true, has_opening_hours: true },
    },
    TODOS,
    0.8,
  );
  assertEquals(brief.diagnostico.length, 0);
  assert(
    brief.resumo_amigo.toLowerCase().includes("bem resolvida"),
    "deve reconhecer que está bem em vez de forçar uma dor",
  );
});

Deno.test("brief: nunca estoura, mesmo com empresa sem sinal nenhum", () => {
  const brief = gerarBrief({ name: "X", signals: {} }, [], 0.25);
  assertExists(brief.segmento);
  assertExists(brief.resumo_amigo);
  assertExists(brief.abertura);
  assert(brief.confianca >= 0);
});

// -----------------------------------------------------------------------------
// Validacao de playbook vindo do banco
// -----------------------------------------------------------------------------

Deno.test("validacao: descarta playbook malformado em vez de estourar", () => {
  assertEquals(validarPlaybook(null), null);
  assertEquals(validarPlaybook({ slug: 123 }), null);
  assertEquals(validarPlaybook({ slug: "x" }), null, "sem label é inválido");

  const parcial = validarPlaybook({
    slug: "teste",
    label: "Teste",
    pains: [
      { codigo: "ok", texto: "válida", gravidade: "alta" },
      { codigo: "ruim", texto: "sem gravidade" },
      "isso nem é objeto",
    ],
    offers: [{ codigo: "x", titulo: "T", porque: "p", pitch: "pi", esforco: "baixo", impacto: "alto" }],
  });

  assertExists(parcial);
  assertEquals(parcial.pains.length, 1, "dor malformada é descartada, o resto sobrevive");
  assertEquals(parcial.offers.length, 1);
  assertEquals(parcial.weight, 50, "assume peso padrão quando não vem");
});

Deno.test("validacao: condicao nao aceita codigo executavel", () => {
  // A condicao e um formato fechado. Qualquer coisa fora de com/sem/qualquer
  // e simplesmente ignorada - nao ha caminho de execucao.
  const sinais = { has_website: false };
  const maliciosa = { eval: "process.exit(1)", com: ["has_website"] } as never;
  assertEquals(avaliarCondicao(maliciosa, sinais), false, "avalia só os campos conhecidos");
});

// -----------------------------------------------------------------------------
// Regressao de redacao
// Estes casos vieram do teste de fumaca com dados reais: passavam no teste
// unitario e mesmo assim o texto saia errado. Ficam travados aqui.
// -----------------------------------------------------------------------------

Deno.test("redacao: nome proprio de marca nao pode ser rebaixado", () => {
  const pb: Playbook = {
    ...PIZZARIA,
    pains: [{
      codigo: "sem_pedido_online",
      texto: "Depende de iFood e paga comissão.",
      gravidade: "alta",
      quando: { sem: ["has_website"] },
    }],
    offers: [{
      codigo: "x",
      titulo: "Cardápio no WhatsApp",
      porque: "aparece melhor no Google",
      pitch: "pensei num cardápio.",
      esforco: "baixo",
      impacto: "alto",
      resolve: ["sem_pedido_online"],
    }],
  };

  const brief = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: { has_website: false } },
    [pb],
    0.6,
  );

  assert(brief.resumo_amigo.includes("iFood"), "iFood não pode virar 'ifood'");
  assert(brief.resumo_amigo.includes("WhatsApp"), "WhatsApp não pode virar 'whatsapp'");
  assert(brief.resumo_amigo.includes("Google"), "Google não pode virar 'google'");
});

Deno.test("redacao: concordancia de artigo com o nome do negocio", () => {
  const casos: Array<[string, string]> = [
    ["Restaurante Popular", "Vi o Restaurante Popular"],
    ["Pizzaria Forno Alto", "Vi a Pizzaria Forno Alto"],
    ["Clínica Nova Pele", "Vi a Clínica Nova Pele"],
    ["Studio Movimento", "Vi o Studio Movimento"],
    ["Bar do Rubens", "Vi o Bar do Rubens"],
  ];

  for (const [nome, esperado] of casos) {
    const brief = gerarBrief({ name: nome, category: "restaurante", signals: {} }, TODOS, 0.6);
    assert(
      brief.abertura.includes(esperado),
      `esperava "${esperado}" na abertura, veio: ${brief.abertura}`,
    );
  }
});

Deno.test("redacao: nome desconhecido monta a frase sem artigo em vez de errar", () => {
  const brief = gerarBrief({ name: "Zumbi Coworking", category: "restaurante", signals: {} }, TODOS, 0.6);
  assert(brief.abertura.includes("Vi Zumbi Coworking"), `veio: ${brief.abertura}`);
  assert(!brief.abertura.includes("Vi a Zumbi"), "não pode chutar artigo errado");
});

Deno.test("redacao: apelido entre parenteses sai do texto", () => {
  const brief = gerarBrief(
    { name: "Restaurante Popular João Goulart (Jango)", category: "restaurante", signals: {} },
    TODOS,
    0.6,
  );
  assert(!brief.abertura.includes("(Jango)"), "apelido entre parênteses deve sair");
  assert(brief.abertura.includes("João Goulart"), "mas o nome não pode ser cortado no meio");
});

Deno.test("redacao: nome muito longo e cortado em palavra inteira", () => {
  const brief = gerarBrief(
    { name: "Associação Beneficente dos Comerciantes de Olaria e Adjacências", category: "restaurante", signals: {} },
    TODOS,
    0.6,
  );
  // "Vi <nome> no mapa aqui da região" — isola o nome
  const trecho = brief.abertura.split(" no mapa ")[0].split("Vi ").pop() ?? "";
  assert(!trecho.includes("Adjacên "), "não pode cortar no meio da palavra");
  assert(trecho.length <= 62, `precisa encurtar nome gigante, veio: ${trecho}`);
});

// -----------------------------------------------------------------------------
// Abordagem em duas etapas (decidida em 23/09)
// -----------------------------------------------------------------------------

const REMETENTE = { nome: "Estevam", bairro: "Olaria" };

Deno.test("abordagem: primeira mensagem diz quem e e o que faz, depois pergunta", () => {
  const brief = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: { has_website: false } },
    TODOS, 0.6, REMETENTE,
  );
  assert(brief.abertura.startsWith("Oi, tudo bem? Aqui é o Estevam, sou de Olaria."), brief.abertura);
  assert(brief.abertura.includes("Trabalho com "), "precisa dizer o que faz");
  assert(brief.abertura.includes("Vi a Pizzaria Forno Alto no mapa aqui da região"), brief.abertura);
  assert(brief.abertura.trim().endsWith("?"), "termina com UMA pergunta");
  assertEquals((brief.abertura.match(/\?/g) ?? []).length, 2, "'tudo bem?' + a pergunta, nada mais");
});

Deno.test("abordagem: primeira mensagem nao oferece nem aponta defeito", () => {
  const brief = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: { has_website: false } },
    TODOS, 0.6, REMETENTE,
  );
  const texto = brief.abertura.toLowerCase();
  for (const proibido of ["pensei num", "dá pra melhorar", "não tem", "precisa de", "vocês deveriam"]) {
    assert(!texto.includes(proibido), `primeira mensagem não pode conter "${proibido}": ${brief.abertura}`);
  }
  if (brief.oferta_principal) {
    assert(!texto.includes(brief.oferta_principal.titulo.toLowerCase()), "a oferta fica para a segunda mensagem");
  }
});

Deno.test("abordagem: segunda mensagem traz a oferta concreta e uma saida", () => {
  const brief = gerarBrief(
    { name: "Pizzaria Forno Alto", category: "pizzaria", signals: {} },
    TODOS, 0.6, REMETENTE,
  );
  assert(brief.segunda_mensagem.includes("Se não for o momento, sem problema"), brief.segunda_mensagem);
  assert(!brief.segunda_mensagem.includes("quer ver como fica"), "convite vago parece spam");
  if (brief.oferta_principal) {
    const inicio = brief.oferta_principal.titulo.slice(1, 12);
    assert(brief.segunda_mensagem.includes(inicio), `precisa citar a oferta: ${brief.segunda_mensagem}`);
  }
});

Deno.test("abordagem: roteiro de ligacao para fixo tem pergunta e saida", () => {
  const brief = gerarBrief(
    { name: "Toca do Boi", category: "restaurant", signals: {} },
    TODOS, 0.6, REMETENTE,
  );
  assert(brief.roteiro_ligacao.includes("Aqui é o Estevam"), brief.roteiro_ligacao);
  assert(brief.roteiro_ligacao.includes("Não volto a ligar"), "saída de LGPD precisa estar no roteiro");
  assert(brief.roteiro_ligacao.includes("Escute"), "o roteiro manda ouvir antes de oferecer");
});

Deno.test("abordagem: sem remetente configurado nao inventa nome", () => {
  const brief = gerarBrief({ name: "Studio Gab Costa", category: "hairdresser", signals: {} }, TODOS, 0.6);
  assert(!brief.abertura.includes("Aqui é o"), brief.abertura);
  assert(brief.abertura.startsWith("Oi, tudo bem? Trabalho com "), brief.abertura);
});

Deno.test("abordagem: apresentacao do playbook entra no texto, com reserva generica", () => {
  const comApresentacao: Playbook = { ...PIZZARIA, apresentacao: "pedido direto pelo WhatsApp para pizzarias da região" };
  const a = gerarBrief({ name: "Pizzaria X", category: "pizzaria", signals: {} }, [comApresentacao], 0.6, REMETENTE);
  assert(a.abertura.includes("Trabalho com pedido direto pelo WhatsApp para pizzarias da região."), a.abertura);
  const b = gerarBrief({ name: "Loja Qualquer", category: "sem_nicho", signals: {} }, [], 0.6, REMETENTE);
  assert(b.abertura.includes("Trabalho com soluções simples para o comércio da região"), b.abertura);
});

Deno.test("REGRESSAO 23/09: artigo nao e chutado pela ultima letra", () => {
  const brief = gerarBrief({ name: "Olaria Atlético Clube", category: "sports_centre", signals: {} }, TODOS, 0.6, REMETENTE);
  assert(!brief.abertura.includes("Vi a Olaria"), brief.abertura);
  assert(brief.abertura.includes("Vi Olaria Atlético Clube"), brief.abertura);
});

Deno.test("REGRESSAO 23/09: nome de ate 60 caracteres nao e cortado", () => {
  const nome = "Centro de Educação Física Almirante Adalberto Nunes";
  const brief = gerarBrief({ name: nome, category: "sports_centre", signals: {} }, TODOS, 0.6, REMETENTE);
  assert(brief.abertura.includes(nome), brief.abertura);
});

Deno.test("I10: lead do cadastro de CNPJ nao diz que foi visto no mapa", () => {
  const pb = validarPlaybook({ slug: "beleza", label: "Salão e estética", match_terms: ["hairdresser"], weight: 75, pains: [], offers: [],
    opening_questions: ["Como vocês fazem hoje quando abre um horário de última hora?"], avoid: ["Não falar em automatizar."],
    apresentacao: "agendamento online para salões e studios da região" })!;
  const empresa = { name: "Studio Bela", category: "hairdresser", city: "Rio de Janeiro", signals: { has_phone: true }, origem: "cadastro" as const };
  const b = gerarBrief(empresa, [pb], 0.4, { nome: "Estevam", bairro: "Olaria" });
  assert(!b.abertura.includes("mapa"), b.abertura);
  assert(b.abertura.includes("Vi o Studio Bela aqui na região e fiquei com uma dúvida"), b.abertura);
  assert(!b.roteiro_ligacao.includes("mapa"), b.roteiro_ligacao);
  assertEquals(b.o_que_evitar[0], AVISO_ORIGEM_CADASTRO);
  assert(b.o_que_evitar.includes("Não falar em automatizar."));
});

Deno.test("I10: lead do mapa continua igual (sem origem = mapa)", () => {
  const pb = validarPlaybook({ slug: "beleza", label: "Salão", match_terms: ["hairdresser"], weight: 75, pains: [], offers: [],
    opening_questions: ["Tudo certo?"], avoid: [] })!;
  const b = gerarBrief({ name: "Studio Bela", category: "hairdresser", signals: {} }, [pb], 0.4, { nome: "Estevam" });
  assert(b.abertura.includes("no mapa aqui da região"), b.abertura);
  assertEquals(b.o_que_evitar.includes(AVISO_ORIGEM_CADASTRO), false);
});

Deno.test("29/09: origem junta as duas fontes", () => {
  assertEquals(origemDe(null), "mapa");
  assertEquals(origemDe({ fonte: "receita_cnpj" }), "cadastro");
  assertEquals(origemDe({ fontes: ["cnpj"] }), "cadastro");
  assertEquals(origemDe({ fontes: ["mapa"] }), "mapa");
  assertEquals(origemDe({ fontes: ["mapa", "cnpj"] }), "ambos");
  assertEquals(origemDe({ fontes: "cnpj" }), "mapa"); // formato estranho nao quebra
});

Deno.test("29/09: brief traz as partes da abertura para o painel remontar", () => {
  const pb = validarPlaybook({ slug: "beleza", label: "Salão", match_terms: ["hairdresser"], weight: 75, pains: [],
    offers: [{ codigo: "agenda", titulo: "Link de agendamento pro Instagram.", porque: "x", pitch: "y", esforco: "baixo", impacto: "alto", faixa_preco: "R$ 300 a R$ 600" }],
    opening_questions: ["Como vocês marcam horário hoje?"], avoid: [], apresentacao: "agendamento online para salões" })!;
  const b = gerarBrief({ name: "Studio Bela", category: "hairdresser", signals: {}, origem: "ambos" }, [pb], 0.6, { nome: "Estevam", bairro: "Olaria" });
  assertEquals(b.partes.quem, "Aqui é o Estevam, sou de Olaria.");
  assertEquals(b.partes.faco, "Trabalho com agendamento online para salões.");
  assertEquals(b.partes.alvo, "o Studio Bela");
  assertEquals(b.partes.onde, "aqui na região");
  assertEquals(b.partes.oferta, "link de agendamento pro Instagram");
  assertEquals(b.partes.faixa_preco, "R$ 300 a R$ 600");
  // a abertura continua sendo a mesma montagem das partes
  assert(b.abertura.includes(`${b.partes.quem} ${b.partes.faco} Vi ${b.partes.alvo} ${b.partes.onde}`), b.abertura);
  assertEquals(b.o_que_evitar[0], AVISO_ORIGEM_CADASTRO);
});

Deno.test("29/09: respostas prontas cobrem as objecoes e nunca pressionam", () => {
  const pb = validarPlaybook({ slug: "beleza", label: "Salão", match_terms: ["hairdresser"], weight: 75, pains: [],
    offers: [{ codigo: "agenda", titulo: "Link de agendamento", porque: "x", pitch: "y", esforco: "baixo", impacto: "alto", faixa_preco: "R$ 300 a R$ 600" }],
    opening_questions: ["Tudo certo?"], avoid: [] })!;
  const cadastro = gerarBrief({ name: "Studio Bela", category: "hairdresser", signals: {}, origem: "cadastro" }, [pb], 0.6, { nome: "Estevam" });
  const r = Object.fromEntries(cadastro.respostas_prontas.map((x) => [x.situacao, x]));
  assert(r["Quanto custa?"].resposta.includes("R$ 300 a R$ 600"), "preço vem do playbook");
  assert(r["Quanto custa?"].resposta.startsWith("Depende"), "sem escopo, não crava preço");
  assert(r["De onde você tirou meu número?"].resposta.includes("CNPJ"));
  assert(r["De onde você tirou meu número?"].resposta.includes("não chame mais"), "sempre oferece sair");
  assertEquals(r["Não tenho interesse / não me chame mais"].depois, "nao_contatar");
  assertEquals(r["Agora não dá / estou sem tempo"].depois, "agendar_retorno");
  assert(r["Quem é você? / É golpe?"].resposta.includes("Aqui é o Estevam"));
  const mapa = gerarBrief({ name: "Studio Bela", category: "hairdresser", signals: {} }, [pb], 0.6, {});
  const deOnde = mapa.respostas_prontas.find((x) => x.situacao.startsWith("De onde"))!;
  assert(deOnde.resposta.includes("OpenStreetMap"), deOnde.resposta);
  // sem faixa de preço no playbook: não inventa número
  const semPreco = gerarBrief({ name: "Loja", category: "x", signals: {} }, [], 0.6, {});
  const custa = semPreco.respostas_prontas.find((x) => x.situacao === "Quanto custa?")!;
  assert(custa.resposta.includes("R$ 300 a R$ 700"), "genérico usa a faixa do playbook genérico");
  for (const x of cadastro.respostas_prontas) {
    assert(!/garant|últimas vagas|só hoje|promoção/i.test(x.resposta), `sem pressão: ${x.resposta}`);
  }
});
