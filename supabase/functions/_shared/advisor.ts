/**
 * Motor consultor.
 *
 * Recebe uma empresa com os sinais extraidos da fonte e um conjunto de
 * playbooks por nicho (que vivem no banco, nao aqui), e devolve um parecer:
 * o que provavelmente doi nesse negocio, o que propor, como abrir a conversa
 * e o que evitar falar.
 *
 * Regra de projeto: este arquivo NAO contem conhecimento de negocio. Todo o
 * "para pizzaria proponha X" mora na tabela niche_playbooks. Isso e proposital
 * - o projeto anterior tinha a tabela rule_sets no banco e os pesos duplicados
 * no TypeScript, e os dois divergiram. Aqui existe uma fonte da verdade so.
 */

import type { Signals } from "./signals.ts";

/** Ausência no cadastro ou no mapa não comprova ausência no negócio. */
export function sinaisConfiaveisParaConsultoria(signals: Signals): Signals {
  const seguros = { ...signals };
  for (const chave of ["has_website", "has_instagram", "has_social", "has_opening_hours"]) {
    if (seguros[chave] === false) seguros[chave] = null;
  }
  return seguros;
}

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

/**
 * Condicao declarativa avaliada contra os sinais. Sem eval, sem expressao em
 * string: o formato e fechado e validado, entao um playbook mal escrito no
 * banco nao consegue executar codigo.
 */
export type Condicao = {
  /** todos estes sinais precisam ser verdadeiros */
  com?: string[];
  /** todos estes sinais precisam ser falsos ou ausentes */
  sem?: string[];
  /** pelo menos um destes precisa ser verdadeiro */
  qualquer?: string[];
};

export type Dor = {
  codigo: string;
  texto: string;
  gravidade: "alta" | "media" | "baixa";
  quando?: Condicao;
};

export type Oferta = {
  codigo: string;
  titulo: string;
  porque: string;
  pitch: string;
  esforco: "baixo" | "medio" | "alto";
  impacto: "alto" | "medio" | "baixo";
  prazo?: string;
  faixa_preco?: string;
  quando?: Condicao;
  /** dores que esta oferta resolve - usado para ranquear */
  resolve?: string[];
};

export type Playbook = {
  slug: string;
  label: string;
  match_terms: string[];
  weight: number;
  pains: Dor[];
  offers: Oferta[];
  opening_questions: string[];
  avoid: string[];
  /**
   * O que voce faz, dito na lingua daquele nicho. Entra na primeira mensagem
   * depois de "Trabalho com". Ex.: "agendamento online para saloes da regiao".
   */
  apresentacao?: string;
};

/** Quem assina a abordagem. Vem de workspaces.settings.remetente. */
export type Remetente = {
  nome?: string | null;
  bairro?: string | null;
};

export type EmpresaParaConsultoria = {
  name: string;
  /** Classificacao do catalogo, definida no banco e corrigivel pela equipe. */
  nicho?: string | null;
  category?: string | null;
  city?: string | null;
  signals: Signals;
  /**
   * De onde veio o lead. Muda uma frase so, mas importa: "vi no mapa" e
   * verdade para quem veio do OpenStreetMap e mentira para quem veio do
   * cadastro de CNPJ. Sem valor, vale "mapa" (o comportamento antigo).
   */
  origem?: Origem;
};

/** "ambos" = a empresa veio das duas fontes (junção de 29/09). */
export type Origem = "mapa" | "cadastro" | "ambos";

/**
 * Origem a partir de companies.metadata. Desde 29/09 a junção grava
 * metadata.fontes (["cnpj"], ["mapa"] ou as duas); antes disso so havia
 * metadata.fonte = "receita_cnpj" nas empresas do cadastro.
 */
export function origemDe(metadata: Record<string, unknown> | null | undefined): Origem {
  const fontes = Array.isArray(metadata?.fontes) ? (metadata!.fontes as unknown[]).map(String) : [];
  const cnpj = fontes.includes("cnpj") || metadata?.fonte === "receita_cnpj";
  const mapa = fontes.includes("mapa");
  if (cnpj && mapa) return "ambos";
  return cnpj ? "cadastro" : "mapa";
}

/** Resposta pronta para "de onde voce tirou meu numero?" (LGPD, art. 9). */
export const AVISO_ORIGEM_CADASTRO =
  "Se perguntarem de onde veio o contato: do cadastro público de empresas (CNPJ) da Receita Federal. Diga com naturalidade e, se a pessoa não quiser conversa, marque \"não contatar\".";

export type Brief = {
  segmento: string;
  playbook_slug: string | null;
  confianca: number;
  diagnostico: Array<{ codigo: string; texto: string; gravidade: string }>;
  oferta_principal: Oferta | null;
  alternativas: Oferta[];
  /** 1a mensagem (WhatsApp/e-mail): apresentacao + UMA pergunta, sem oferta. */
  abertura: string;
  /** Sugestao para quando a pessoa responder: oferta concreta e com saida. */
  segunda_mensagem: string;
  /** Roteiro para telefone fixo, que nao recebe WhatsApp. */
  roteiro_ligacao: string;
  /**
   * Desde 29/09: as pecas da abertura, para o painel remontar a mensagem com
   * o que o Estevam viu (nota no Google, cardapio que nao achou...). O texto
   * final continua sendo do banco (editar_rascunho), nunca so do navegador.
   */
  partes: PartesMensagem;
  /** Desde 29/09: respostas para as objecoes mais comuns, ja no tom certo. */
  respostas_prontas: RespostaPronta[];
  o_que_evitar: string[];
  proximo_passo: string;
  resumo_amigo: string;
  gerado_por: "regras" | "ia";
};

// -----------------------------------------------------------------------------
// Avaliacao de condicoes
// -----------------------------------------------------------------------------

/**
 * Trata o valor do sinal como booleano.
 * Importante: null significa "nao sabemos", e nao "nao tem". A distincao
 * importa para nao afirmar com confianca coisas que nao foram observadas.
 */
function verdadeiro(signals: Signals, chave: string): boolean {
  const valor = signals[chave];
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor > 0;
  if (typeof valor === "string") return valor !== "false" && valor.trim().length > 0;
  return false;
}

export function avaliarCondicao(condicao: Condicao | undefined, signals: Signals): boolean {
  if (!condicao) return true;

  if (condicao.com?.length) {
    if (!condicao.com.every((chave) => verdadeiro(signals, chave))) return false;
  }

  if (condicao.sem?.length) {
    if (!condicao.sem.every((chave) => signals[chave] === false || signals[chave] === "false")) return false;
  }

  if (condicao.qualquer?.length) {
    if (!condicao.qualquer.some((chave) => verdadeiro(signals, chave))) return false;
  }

  return true;
}

// -----------------------------------------------------------------------------
// Escolha do playbook
// -----------------------------------------------------------------------------

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Escolhe o playbook do nicho comparando os termos com categoria, nome e
 * cozinha. Desempata por weight, depois por termo mais especifico - "pizzaria"
 * deve ganhar de "restaurante" quando os dois casam.
 */
export function escolherPlaybook(
  empresa: EmpresaParaConsultoria,
  playbooks: Playbook[],
): Playbook | null {
  const classificado = empresa.nicho && playbooks.find(p => p.slug === empresa.nicho);
  if (classificado) return classificado;
  const alvo = [
    normalizar(empresa.category),
    normalizar(empresa.name),
    normalizar(String(empresa.signals.cuisine ?? "")),
  ].join(" ");

  let melhor: { playbook: Playbook; pontos: number } | null = null;

  for (const playbook of playbooks) {
    let pontos = 0;
    let maiorTermo = 0;

    for (const termo of playbook.match_terms) {
      const t = normalizar(termo);
      const palavras = alvo.replace(/[^a-z0-9]+/g, " ").trim();
      const termoCompleto = t.replace(/[^a-z0-9]+/g, " ").trim();
      if (termoCompleto && ` ${palavras} `.includes(` ${termoCompleto} `)) {
        pontos += 1;
        maiorTermo = Math.max(maiorTermo, t.length);
      }
    }

    if (pontos === 0) continue;

    // termo mais longo = mais especifico, e peso do playbook como desempate final
    const score = pontos * 1000 + maiorTermo * 10 + playbook.weight;

    if (!melhor || score > melhor.pontos) {
      melhor = { playbook, pontos: score };
    }
  }

  return melhor?.playbook ?? null;
}

// -----------------------------------------------------------------------------
// Ranqueamento de ofertas
// -----------------------------------------------------------------------------

const PESO_ESFORCO = { baixo: 3, medio: 2, alto: 1 } as const;
const PESO_IMPACTO = { alto: 3, medio: 2, baixo: 1 } as const;

/**
 * Ordena ofertas por (impacto x facilidade), com bonus para ofertas que
 * resolvem dores efetivamente detectadas neste lead. A ideia e sempre comecar
 * pela proposta mais facil de aceitar, nao pela mais cara.
 */
function ranquearOfertas(ofertas: Oferta[], doresDetectadas: Set<string>): Oferta[] {
  return [...ofertas].sort((a, b) => {
    const resolveA = (a.resolve ?? []).filter((d) => doresDetectadas.has(d)).length;
    const resolveB = (b.resolve ?? []).filter((d) => doresDetectadas.has(d)).length;

    const scoreA = resolveA * 10 + PESO_IMPACTO[a.impacto] * 2 + PESO_ESFORCO[a.esforco];
    const scoreB = resolveB * 10 + PESO_IMPACTO[b.impacto] * 2 + PESO_ESFORCO[b.esforco];

    return scoreB - scoreA;
  });
}

// -----------------------------------------------------------------------------
// Redacao do parecer em voz de gente
// -----------------------------------------------------------------------------

/**
 * Prepara o nome da empresa para uso no meio de uma frase.
 * Tira o que vem entre parenteses (o OSM usa muito para apelido) e corta com
 * bom senso em vez de contar palavras - "Restaurante Popular Joao Goulart"
 * cortado em 3 palavras virava "Restaurante Popular Joao", que fica pior.
 */
function nomeCurto(nomeEmpresa: string): string {
  const limpo = nomeEmpresa
    .replace(/\s*[(\[][^)\]]*[)\]]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 60 e nao 42: com 42, "Centro de Educacao Fisica Almirante Adalberto
  // Nunes" virava "...Fisica Almirante", nome cortado no meio da frase.
  if (limpo.length <= 60) return limpo;

  // corta na ultima palavra inteira que couber
  const cortado = limpo.slice(0, 60);
  const ultimoEspaco = cortado.lastIndexOf(" ");
  return (ultimoEspaco > 20 ? cortado.slice(0, ultimoEspaco) : cortado).trim();
}

/**
 * Escolhe "a" ou "o" para o nome do estabelecimento.
 * Sem isso o texto sai "Olha a Restaurante Popular", que denuncia na hora que
 * quem escreveu foi uma maquina. Quando nao da para saber com seguranca,
 * devolve string vazia e a frase e montada sem artigo.
 */
const FEMININOS = [
  "pizzaria", "clinica", "padaria", "academia", "escola", "oficina", "loja",
  "cantina", "casa", "farmacia", "drogaria", "sorveteria", "hamburgueria",
  "lanchonete", "barbearia", "churrascaria", "confeitaria", "adega", "banca",
  "creche", "papelaria", "otica", "floricultura", "imobiliaria", "pousada",
  "pastelaria", "cafeteria", "livraria", "boutique", "galeria", "mercearia",
  "oficina", "autoescola", "distribuidora", "assistencia", "agencia",
];

const MASCULINOS = [
  "restaurante", "bar", "boteco", "salao", "mercado", "mercadinho", "studio",
  "estudio", "acougue", "hotel", "posto", "centro", "espaco", "atelie",
  "consultorio", "laboratorio", "petshop", "supermercado", "buffet", "clube",
  "instituto", "colegio", "cursinho", "hortifruti", "emporio", "deposito",
  "quiosque", "chopp", "sebo", "bistro", "spa",
];

function semAcento(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function artigo(nome: string): "a " | "o " | "" {
  const primeira = semAcento(nome.trim().split(/\s+/)[0] ?? "");
  if (FEMININOS.includes(primeira)) return "a ";
  if (MASCULINOS.includes(primeira)) return "o ";
  // Sem chute. A heuristica antiga ("terminou em 'a' e feminino") produzia
  // "Vi a Olaria Atletico Clube". Fora do dicionario, a frase sai sem artigo:
  // "Vi Olaria Atletico Clube" soa um pouco seco, mas nunca soa errado.
  return "";
}

/**
 * Deixa uma frase pronta para entrar no meio de outra: tira o ponto final e
 * rebaixa apenas a PRIMEIRA letra. Rebaixar a frase inteira estragava nome
 * proprio - "Google" virava "google" e "iFood" virava "ifood", o que faz o
 * texto parecer descuidado justamente na hora de falar com o cliente.
 */
function encaixarNaFrase(texto: string): string {
  const semPonto = texto.trim().replace(/\.$/, "");
  if (!semPonto) return "";

  const primeira = semPonto[0];
  const resto = semPonto.slice(1);

  // Se as duas primeiras letras sao maiusculas, e provavelmente sigla ou nome
  // proprio estilizado (iFood, WhatsApp) - nesse caso nao mexe.
  if (/[A-Z]/.test(primeira) && /^[A-Z]/.test(resto)) return semPonto;

  return primeira.toLowerCase() + resto;
}

function listarEmPortugues(itens: string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0];
  if (itens.length === 2) return `${itens[0]}; e ${itens[1]}`;
  return `${itens.slice(0, -1).join("; ")}; e ${itens[itens.length - 1]}`;
}

/**
 * Escreve o parecer como um amigo comentaria: comeca pelo que chamou atencao,
 * diz o que faria, e admite quando esta com pouca informacao.
 */
function escreverResumoAmigo(params: {
  empresa: EmpresaParaConsultoria;
  segmento: string;
  dores: Dor[];
  ofertaPrincipal: Oferta | null;
  confianca: number;
}): string {
  const { empresa, segmento, dores, ofertaPrincipal, confianca } = params;
  const nome = nomeCurto(empresa.name);
  const art = artigo(nome);
  const partes: string[] = [];

  if (dores.length === 0) {
    partes.push(confianca < 0.5
      ? `Dados insuficientes para avaliar ${nome}. Confirme site, redes e atendimento antes de sugerir uma oferta.`
      : `${art ? art.charAt(0).toUpperCase() + art.slice(1) : ""}${nome} ` +
        `parece bem resolvida no que dá pra ver daqui: não achei buraco óbvio de presença digital.`);
  } else {
    const doresAltas = dores.filter((d) => d.gravidade === "alta");
    const destaque = (doresAltas.length ? doresAltas : dores).slice(0, 2);
    partes.push(
      `${nome} é ${encaixarNaFrase(segmento)}. ` +
      `Hipóteses a confirmar com a empresa, não fatos verificados: ${listarEmPortugues(destaque.map((d) => encaixarNaFrase(d.texto)))}.`,
    );
  }

  if (ofertaPrincipal) {
    partes.push(
      `Se fosse eu, entrava por ${encaixarNaFrase(ofertaPrincipal.titulo)} — ` +
      `${encaixarNaFrase(ofertaPrincipal.porque)}.`,
    );

    if (ofertaPrincipal.esforco === "baixo" && ofertaPrincipal.impacto === "alto") {
      partes.push(`O playbook estima uma entrega menor; confirme escopo, demanda e orçamento antes de propor.`);
    } else if (ofertaPrincipal.esforco === "alto") {
      partes.push(`Só que é entrega grande — talvez valha começar por algo menor e crescer depois.`);
    }
  }

  if (confianca < 0.45) {
    partes.push(
      `Aviso: o cadastro desse lugar tem pouca informação, então esse palpite é fraco. ` +
      `Vale dar uma olhada no Instagram ou ligar antes de investir tempo.`,
    );
  }

  return partes.join(" ");
}

/** Primeira letra minuscula, preservando sigla e nome estilizado (iFood). */
function minusculaInicial(texto: string): string {
  const t = texto.trim();
  if (!t) return "";
  if (/^[A-Z]{2}/.test(t) || /^[a-z][A-Z]/.test(t)) return t;
  return t[0].toLowerCase() + t.slice(1);
}

const APRESENTACAO_GENERICA =
  "soluções simples para o comércio da região, como agenda online, pedidos pelo WhatsApp e lembretes automáticos";

export type PartesMensagem = {
  quem: string;        // "Aqui é o Estevam, sou de Olaria." ou ""
  faco: string;        // "Trabalho com agendamento online para salões da região."
  alvo: string;        // "o Studio Gab Costa"
  onde: string;        // "no mapa aqui da região" (OSM) ou "aqui na região" (CNPJ)
  pergunta: string;    // "hoje as clientes marcam horário por mensagem...?"
  oferta: string;      // "link de agendamento pro Instagram" ou ""
  /** Faixa de preco da oferta principal ("R$ 300 a R$ 700") ou "". */
  faixa_preco: string;
};
type Partes = PartesMensagem;

export type RespostaPronta = {
  /** O que a pessoa disse: "Quanto custa?" */
  situacao: string;
  /** O que responder, pronto para copiar. */
  resposta: string;
  /** Acao no painel depois de responder, quando houver. */
  depois?: "nao_contatar" | "agendar_retorno" | "mandar_exemplo";
};

/**
 * Monta as pecas da abordagem. Regras (decididas com o Estevam em 23/09):
 * - a primeira mensagem diz QUEM e e O QUE FAZ, e depois faz UMA pergunta;
 * - nenhuma oferta e nenhum defeito apontado na primeira mensagem (o
 *   diagnostico vem do OpenStreetMap, que e incompleto: "nao tem site" pode
 *   ser falso);
 * - a oferta so aparece na segunda mensagem, concreta e com saida facil;
 * - nada de prova social inventada.
 */
function montarPartes(
  empresa: EmpresaParaConsultoria,
  playbook: Playbook,
  oferta: Oferta | null,
  remetente: Remetente,
): Partes {
  const nome = nomeCurto(empresa.name);
  const nomeRemetente = (remetente.nome ?? "").trim();
  const bairro = (remetente.bairro ?? "").trim();

  const quem = nomeRemetente
    ? `Aqui é o ${nomeRemetente}${bairro ? `, sou de ${bairro}` : ""}.`
    : "";

  const apresentacao = (playbook.apresentacao ?? "").trim() || APRESENTACAO_GENERICA;
  const pergunta = (playbook.opening_questions?.[0] ?? "").trim()
    || "Hoje como é que chega cliente novo pra vocês?";

  return {
    quem,
    faco: `Trabalho com ${apresentacao.replace(/\.$/, "")}.`,
    alvo: `${artigo(nome)}${nome}`,
    onde: empresa.origem === "cadastro" || empresa.origem === "ambos" ? "aqui na região" : "no mapa aqui da região",
    pergunta: minusculaInicial(pergunta),
    oferta: oferta ? minusculaInicial(oferta.titulo.replace(/\.$/, "")) : "",
    faixa_preco: (oferta?.faixa_preco ?? "").trim(),
  };
}

function escreverAbertura(p: Partes): string {
  return [
    "Oi, tudo bem?",
    p.quem,
    p.faco,
    `Vi ${p.alvo} ${p.onde} e fiquei com uma dúvida: ${p.pergunta}`,
  ].filter(Boolean).join(" ");
}

function escreverSegundaMensagem(p: Partes): string {
  const motivo = p.oferta
    ? `Pergunto porque é justamente com isso que eu trabalho: ${p.oferta}.`
    : "Pergunto porque é justamente com esse tipo de coisa que eu trabalho.";
  return `Legal, obrigado por responder! ${motivo} Se fizer sentido, te mando um exemplo curto de como fica, é rapidinho de ver. Se não for o momento, sem problema também.`;
}

function escreverRoteiroLigacao(p: Partes): string {
  const apresentacao = [p.quem, p.faco].filter(Boolean).join(" ");
  const ponte = p.oferta
    ? `Pergunto porque é justamente com isso que eu trabalho: ${p.oferta}. Posso te mandar um exemplo pelo WhatsApp? Qual o melhor número?`
    : "Pergunto porque é com esse tipo de coisa que eu trabalho. Posso te mandar um exemplo pelo WhatsApp? Qual o melhor número?";
  return [
    "ROTEIRO DE LIGAÇÃO (telefone fixo, sem WhatsApp)",
    "",
    `1. Apresentação: "Bom dia! ${apresentacao} Falo com o responsável?"`,
    `2. Pergunta: "Vi vocês ${p.onde} e queria te fazer uma pergunta rápida: ${p.pergunta}"`,
    "3. Escute a resposta sem interromper. Não fale do produto antes disso.",
    `4. Se houver abertura: "${ponte}"`,
    `5. Se não quiser conversar: "Sem problema, obrigado pelo seu tempo. Não volto a ligar." E marque "não contatar" no painel.`,
  ].join("\n");
}

/**
 * Respostas para as objecoes que mais aparecem no WhatsApp. Regras:
 * - nunca pressionar: toda resposta tem saida facil;
 * - preco so com faixa real do playbook (nada inventado) e sempre com
 *   "depende", porque o escopo ainda nao foi conversado;
 * - "de onde tirou meu numero" responde a verdade (LGPD, art. 9) e oferece
 *   parar de chamar.
 */
function escreverRespostasProntas(p: Partes, origem: EmpresaParaConsultoria["origem"]): RespostaPronta[] {
  const oferta = p.oferta || "isso";
  const preco = p.faixa_preco
    ? `Depende do que vocês precisarem, mas ${oferta} costuma ficar entre ${p.faixa_preco}. Antes de falar de valor, prefiro te mostrar um exemplo e entender como funciona aí hoje. Pode ser?`
    : `Depende do que vocês precisarem. Antes de falar de valor, prefiro te mostrar um exemplo e entender como funciona aí hoje. Pode ser?`;
  const fonte = origem === "cadastro"
    ? "Peguei no cadastro público de empresas (CNPJ), que é aberto. Se preferir que eu não chame mais, é só falar que eu tiro seu número da lista."
    : origem === "ambos"
    ? "Peguei no cadastro público de empresas (CNPJ) e no mapa (OpenStreetMap), que são abertos. Se preferir que eu não chame mais, é só falar que eu tiro seu número da lista."
    : "Estava no cadastro do estabelecimento no mapa (OpenStreetMap), que é público. Se preferir que eu não chame mais, é só falar que eu tiro seu número da lista.";
  const apresentacao = [p.quem, p.faco].filter(Boolean).join(" ");
  return [
    { situacao: "Quanto custa?", resposta: preco, depois: "mandar_exemplo" },
    {
      situacao: "Me manda mais informações / um exemplo",
      resposta: `Claro! Vou te mandar um exemplo curto de como fica, é rapidinho de ver. [cole aqui o link do seu modelo] Qualquer dúvida, me chama por aqui.`,
      depois: "mandar_exemplo",
    },
    {
      situacao: "Já tenho / não preciso",
      resposta: "Entendi, faz todo sentido! Obrigado por responder. Se um dia quiser comparar ou ajustar alguma coisa, fico à disposição.",
    },
    {
      situacao: "Agora não dá / estou sem tempo",
      resposta: "Tranquilo, sem pressa! Posso te chamar de novo daqui a umas semanas? Se preferir outro dia, me fala.",
      depois: "agendar_retorno",
    },
    { situacao: "De onde você tirou meu número?", resposta: fonte },
    {
      situacao: "Quem é você? / É golpe?",
      resposta: `Pergunta justa! ${apresentacao || "Trabalho com soluções para o comércio da região."} Não peço pagamento adiantado nem dado nenhum. Se preferir, a gente conversa por vídeo ou pessoalmente antes de qualquer coisa.`,
    },
    {
      situacao: "Não tenho interesse / não me chame mais",
      resposta: "Sem problema, obrigado pelo retorno! Não volto a chamar. Bom trabalho aí!",
      depois: "nao_contatar",
    },
  ];
}

// -----------------------------------------------------------------------------
// Ponto de entrada
// -----------------------------------------------------------------------------

/** Playbook usado quando nenhum nicho especifico casa. */
export const PLAYBOOK_GENERICO: Playbook = {
  slug: "generico",
  label: "Negócio local",
  match_terms: [],
  weight: 0,
  pains: [
    {
      codigo: "sem_presenca_digital",
      texto: "A fonte não informou site nem rede social. Confirme os canais atuais de divulgação.",
      gravidade: "alta",
      quando: { sem: ["has_website", "has_social"] },
    },
    {
      codigo: "sem_canal_contato",
      texto: "A fonte não informou telefone nem e-mail. É necessário confirmar como entrar em contato.",
      gravidade: "alta",
      quando: { sem: ["has_any_contact"] },
    },
    {
      codigo: "sem_horario",
      texto: "A fonte não informou o horário de funcionamento. Confira se ele aparece em outros canais.",
      gravidade: "media",
      quando: { sem: ["has_opening_hours"] },
    },
  ],
  offers: [
    {
      codigo: "presenca_basica",
      titulo: "Montar a presença básica no Google e WhatsApp",
      porque: "quem não aparece na busca perde cliente que já estava procurando",
      pitch: "pensei numa forma simples de fazer o negócio aparecer pra quem procura na região.",
      esforco: "baixo",
      impacto: "alto",
      prazo: "3 a 7 dias",
      faixa_preco: "R$ 300 a R$ 700",
      resolve: ["sem_presenca_digital", "sem_horario"],
    },
    {
      codigo: "atendimento_whatsapp",
      titulo: "Organizar o atendimento no WhatsApp",
      porque: "mensagem que fica sem resposta é venda que foi embora",
      pitch: "notei que talvez dê pra melhorar o tempo de resposta no WhatsApp.",
      esforco: "baixo",
      impacto: "medio",
      prazo: "1 semana",
      faixa_preco: "R$ 400 a R$ 900",
      resolve: ["sem_canal_contato"],
    },
  ],
  opening_questions: ["Hoje como é que chega cliente novo pra vocês?"],
  avoid: [
    "Não falar em 'transformação digital' nem 'inteligência artificial' — assusta e soa caro.",
    "Não prometer número de vendas que você não tem como garantir.",
  ],
};

export function gerarBrief(
  empresa: EmpresaParaConsultoria,
  playbooks: Playbook[],
  confianca: number,
  remetente: Remetente = {},
): Brief {
  const playbook = escolherPlaybook(empresa, playbooks) ?? PLAYBOOK_GENERICO;

  // 1. Quais dores do playbook realmente se aplicam a este lead
  const dores = playbook.pains.filter((dor) => avaliarCondicao(dor.quando, empresa.signals));
  const doresDetectadas = new Set(dores.map((d) => d.codigo));

  // 2. Quais ofertas fazem sentido, ranqueadas
  const ofertasAplicaveis = playbook.offers.filter((oferta) =>
    avaliarCondicao(oferta.quando, empresa.signals)
  );
  const ranqueadas = ranquearOfertas(ofertasAplicaveis, doresDetectadas);

  const ofertaPrincipal = ranqueadas[0] ?? null;
  const alternativas = ranqueadas.slice(1, 3);

  // 3. Ajuste de confianca: rede/franquia derruba, porque a decisao nao e local
  let confiancaFinal = confianca;
  if (empresa.signals.is_chain === true) {
    confiancaFinal = Math.min(confiancaFinal, 0.35);
  }

  const proximoPasso = empresa.signals.is_chain === true
    ? "Parece rede ou franquia — a decisão provavelmente não é na loja. Vale despriorizar."
    : dores.length === 0
      ? "Poucos buracos visíveis. Vale olhar o Instagram antes de investir tempo."
      : ofertaPrincipal
        ? "Mandar a abertura. Se responder, usar a segunda mensagem sugerida e entender como funciona hoje antes de propor."
        : "Levantar mais informação antes de abordar.";

  return {
    segmento: playbook.label,
    playbook_slug: playbook === PLAYBOOK_GENERICO ? null : playbook.slug,
    confianca: Math.round(confiancaFinal * 100) / 100,
    diagnostico: dores.map((d) => ({ codigo: d.codigo, texto: d.texto, gravidade: d.gravidade })),
    oferta_principal: ofertaPrincipal,
    alternativas,
    ...(() => {
      const partes = montarPartes(empresa, playbook, ofertaPrincipal, remetente);
      return {
        abertura: escreverAbertura(partes),
        segunda_mensagem: escreverSegundaMensagem(partes),
        roteiro_ligacao: escreverRoteiroLigacao(partes),
        partes,
        respostas_prontas: escreverRespostasProntas(partes, empresa.origem),
      };
    })(),
    o_que_evitar: empresa.origem === "cadastro" || empresa.origem === "ambos"
      ? [AVISO_ORIGEM_CADASTRO, ...playbook.avoid] : playbook.avoid,
    proximo_passo: proximoPasso,
    resumo_amigo: escreverResumoAmigo({
      empresa,
      segmento: playbook.label,
      dores,
      ofertaPrincipal,
      confianca: confiancaFinal,
    }),
    gerado_por: "regras",
  };
}

// -----------------------------------------------------------------------------
// Validacao de playbook vindo do banco
// -----------------------------------------------------------------------------

/**
 * Playbooks sao dados editaveis. Um playbook malformado nao pode derrubar a
 * analise do lote inteiro - por isso validamos e descartamos o invalido em vez
 * de deixar estourar.
 */
export function validarPlaybook(bruto: unknown): Playbook | null {
  if (!bruto || typeof bruto !== "object") return null;
  const p = bruto as Record<string, unknown>;

  if (typeof p.slug !== "string" || typeof p.label !== "string") return null;

  const gravidades = ["alta", "media", "baixa"];
  const esforcos = ["baixo", "medio", "alto"];
  const impactos = ["alto", "medio", "baixo"];

  const pains = Array.isArray(p.pains)
    ? (p.pains as Record<string, unknown>[]).filter(
        (d) =>
          typeof d?.codigo === "string" &&
          typeof d?.texto === "string" &&
          gravidades.includes(String(d?.gravidade)),
      )
    : [];

  const offers = Array.isArray(p.offers)
    ? (p.offers as Record<string, unknown>[]).filter(
        (o) =>
          typeof o?.codigo === "string" &&
          typeof o?.titulo === "string" &&
          typeof o?.porque === "string" &&
          typeof o?.pitch === "string" &&
          esforcos.includes(String(o?.esforco)) &&
          impactos.includes(String(o?.impacto)),
      )
    : [];

  return {
    slug: p.slug,
    label: p.label,
    match_terms: Array.isArray(p.match_terms) ? (p.match_terms as string[]).filter((t) => typeof t === "string") : [],
    weight: typeof p.weight === "number" ? p.weight : 50,
    pains: pains as unknown as Dor[],
    offers: offers as unknown as Oferta[],
    opening_questions: Array.isArray(p.opening_questions)
      ? (p.opening_questions as string[]).filter((q) => typeof q === "string")
      : [],
    avoid: Array.isArray(p.avoid) ? (p.avoid as string[]).filter((a) => typeof a === "string") : [],
    apresentacao: typeof p.apresentacao === "string" && p.apresentacao.trim()
      ? p.apresentacao.trim().slice(0, 200)
      : undefined,
  };
}
