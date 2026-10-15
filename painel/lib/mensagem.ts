/**
 * "O que você viu" (29/09): a primeira mensagem com o que o Estevam
 * conferiu com os próprios olhos antes de mandar.
 *
 * Regras combinadas:
 *  - elogio verdadeiro primeiro (nota do Google só entra se for boa: >= 4,0;
 *    nota baixa nunca é citada);
 *  - a observação é o que ele NÃO achou, dita como constatação dele ("não
 *    encontrei"), nunca como defeito da empresa ("vocês não têm");
 *  - termina na pergunta do playbook, sem oferta e sem link;
 *  - o rodapé de saída (LGPD) é do banco: editar_rascunho recoloca se sumir.
 *
 * As peças (quem, faço, alvo, pergunta) vêm do consultor (advisor_brief.partes).
 * Brief antigo não tem partes: aí o painel mostra o texto já escrito.
 */
import type { PartesMensagem } from '@/lib/tipos';

export type OQueViu = {
  onde: string;          // chave de ONDE_VIU
  nota: string;          // "4,8" ou ""
  observacao: string;    // chave de OBSERVACOES[segmento] ou "outra"
  outra: string;         // texto livre quando observacao = "outra"
  /** Jeito de abrir (30/09): chave de ESTILOS. Vazio = "elogio" (o de 29/09). */
  estilo?: string;
  /** Estilo "cliente": o Estevam confirmou que procurou como cliente de verdade. */
  aconteceu?: boolean;
};

export const ONDE_VIU: Record<string, string> = {
  google: 'no Google',
  maps: 'no Google Maps',
  instagram: 'no Instagram',
  ifood: 'no iFood',
  regiao: 'aqui na região',
};

/** O que costuma faltar em cada segmento (chaves = slugs dos playbooks). */
export const OBSERVACOES: Record<string, Record<string, string>> = {
  restaurante: {
    cardapio: 'Só não encontrei o cardápio de vocês online.',
    reserva: 'Só não achei um jeito de reservar mesa pelo celular.',
    site: 'Só não encontrei um site de vocês.',
  },
  pizzaria: {
    cardapio: 'Só não encontrei o cardápio de vocês online.',
    pedido: 'Só não achei como pedir direto com vocês, sem ser por aplicativo.',
    site: 'Só não encontrei um site de vocês.',
  },
  lanchonete: {
    cardapio: 'Só não encontrei o cardápio de vocês online.',
    pedido: 'Só não achei como pedir direto com vocês, sem ser por aplicativo.',
  },
  sorveteria: {
    cardapio: 'Só não encontrei os sabores e tamanhos atualizados online.',
    pedido: 'Só não achei como pedir diretamente pelo WhatsApp.',
  },
  bar: {
    cardapio: 'Só não encontrei o cardápio de vocês online.',
    agenda: 'Só não achei onde vocês divulgam a programação da semana.',
  },
  padaria: {
    encomenda: 'Só não achei como fazer encomenda pelo celular.',
    horario: 'Só não encontrei o horário de vocês atualizado no Google.',
  },
  beleza: {
    agenda: 'Só não achei um link para agendar horário online.',
    insta: 'O Instagram está bonito, só não achei um link para agendar por lá.',
    site: 'Só não encontrei um site de vocês.',
  },
  barbearia: {
    agenda: 'Só não encontrei um link para reservar horário.',
    servicos: 'Só não achei uma lista atualizada de serviços e valores.',
  },
  manicure: {
    agenda: 'Só não encontrei um link para agendar horário.',
    vitrine: 'Só não achei uma vitrine dos serviços e trabalhos de vocês.',
  },
  estetica: {
    agenda: 'Só não achei como agendar uma avaliação.',
    servicos: 'Só não encontrei uma página com os serviços de vocês.',
  },
  petshop: {
    agenda: 'Só não achei como agendar banho e tosa online.',
    site: 'Só não encontrei um site de vocês.',
  },
  academia: {
    planos: 'Só não encontrei os planos e horários de vocês online.',
    aula: 'Só não achei como marcar uma aula experimental pelo celular.',
  },
  odonto: {
    agenda: 'Só não achei como marcar consulta online.',
    site: 'Só não encontrei um site do consultório.',
  },
  clinica: {
    agenda: 'Só não achei como marcar consulta online.',
    site: 'Só não encontrei um site da clínica.',
  },
  oficina: {
    orcamento: 'Só não achei como pedir orçamento pelo celular.',
    site: 'Só não encontrei um site de vocês.',
  },
  mercado: {
    entrega: 'Só não achei se vocês fazem entrega pelo WhatsApp.',
    ofertas: 'Só não encontrei onde vocês divulgam as ofertas da semana.',
  },
  educacao: {
    matricula: 'Só não encontrei como fazer matrícula ou pedir informação online.',
    site: 'Só não encontrei um site de vocês.',
  },
  generico: {
    site: 'Só não encontrei um site de vocês.',
    horario: 'Só não encontrei o horário de vocês atualizado no Google.',
  },
};

/** Vale para todo segmento (30/09): muita empresa do CNPJ não aparece no Google. */
const NAO_ACHEI_NO_GOOGLE: Record<string, string> = { nao_google: 'Só procurei vocês no Google Maps e não encontrei o perfil de vocês.' };

export function observacoesDo(segmento: string | null | undefined): Record<string, string> {
  return { ...(OBSERVACOES[segmento ?? ''] ?? OBSERVACOES.generico), ...NAO_ACHEI_NO_GOOGLE };
}

/** "4,8" / "4.8" -> 4.8; fora de 1..5 -> null. */
export function lerNota(texto: string): number | null {
  const n = Number(texto.replace(',', '.').trim());
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

const maiuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** Monta a abertura no estilo "elogio". Sem nada preenchido, fica igual à do consultor. */
export function montarAbertura(p: PartesMensagem, viu: OQueViu, segmento: string | null | undefined): string {
  // "Não encontrei no Google" não combina com "vi no Google" nem com nota do Google.
  const naoAchou = viu.observacao === 'nao_google';
  const onde = (naoAchou && ['google', 'maps'].includes(viu.onde) ? undefined : ONDE_VIU[viu.onde]) ?? p.onde;
  const nota = naoAchou ? null : lerNota(viu.nota);
  const elogio = nota !== null && nota >= 4
    ? ` e reparei que vocês são muito bem avaliados${['google', 'maps'].includes(viu.onde) ? '' : ' no Google'} (nota ${nota.toLocaleString('pt-BR', { minimumFractionDigits: 1 })})!`
    : '.';
  const observacao = viu.observacao === 'outra'
    ? viu.outra.trim().replace(/([^.!?])$/, '$1.')
    : observacoesDo(segmento)[viu.observacao] ?? '';
  const pergunta = observacao
    ? `${maiuscula(p.pergunta)}`
    : `Fiquei com uma dúvida: ${p.pergunta}`;
  return [
    'Oi, tudo bem?',
    p.quem,
    p.faco,
    `Vi ${p.alvo} ${onde}${elogio}`,
    observacao,
    pergunta,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// -----------------------------------------------------------------------------
// Jeitos de abrir (30/09). Ideia do Estevam: contar a experiência de quem
// procurou a empresa ("fui ver o cardápio e não achei"), em vez de apontar
// defeito. Regras que valem para os 5:
//  - só diz o que aconteceu de verdade: "não consegui" só com o que ele marcou
//    em "o que você tentou"; o estilo "cliente" exige confirmação explícita;
//  - diz quem é e o que faz logo no começo (nada de parecer cliente e depois
//    vender, exceto no "cliente", que é real e se apresenta em seguida);
//  - termina na pergunta do playbook, sem oferta e sem link;
//  - curta: cabe na pré-visualização do WhatsApp.
// -----------------------------------------------------------------------------

export const ESTILOS: Record<string, { rotulo: string; quando: string }> = {
  pesquisa: { rotulo: 'Pesquisa', quando: 'Você procurou algo da empresa e não achou. O padrão.' },
  elogio: { rotulo: 'Elogio', quando: 'A empresa aparece bem no Google (nota 4,0 ou mais).' },
  cliente: { rotulo: 'Fui cliente', quando: 'Só se você procurou como cliente de verdade.' },
  vizinho: { rotulo: 'Sou da região', quando: 'Empresa do Rio: você é daqui e isso aproxima.' },
  curta: { rotulo: 'Curta e direta', quando: 'Dono ocupado: só a pergunta, sem história.' },
};

/** Como falar do segmento: "os restaurantes" / "um restaurante". */
const SEGMENTO_TEXTO: Record<string, [string, string]> = {
  restaurante: ['os restaurantes', 'um restaurante'],
  pizzaria: ['as pizzarias', 'uma pizzaria'],
  lanchonete: ['as lanchonetes', 'uma lanchonete'],
  bar: ['os bares', 'um bar'],
  padaria: ['as padarias', 'uma padaria'],
  beleza: ['os salões', 'um salão'],
  petshop: ['os pet shops', 'um pet shop'],
  academia: ['as academias', 'uma academia'],
  odonto: ['os dentistas', 'um dentista'],
  clinica: ['as clínicas', 'uma clínica'],
  oficina: ['as oficinas', 'uma oficina'],
  mercado: ['os mercados', 'um mercado'],
  educacao: ['os cursos', 'um curso'],
  generico: ['o comércio', 'um lugar assim'],
};

/** O que ele tentou fazer, por segmento (mesmas chaves de OBSERVACOES). */
const TENTATIVAS: Record<string, Record<string, string>> = {
  restaurante: { cardapio: 'ver o cardápio', reserva: 'reservar uma mesa', site: 'achar o site de vocês' },
  pizzaria: { cardapio: 'ver o cardápio', pedido: 'pedir direto com vocês', site: 'achar o site de vocês' },
  lanchonete: { cardapio: 'ver o cardápio', pedido: 'pedir direto com vocês' },
  bar: { cardapio: 'ver o cardápio', agenda: 'ver a programação da semana' },
  padaria: { encomenda: 'fazer uma encomenda', horario: 'ver o horário de vocês' },
  beleza: { agenda: 'marcar um horário', insta: 'agendar pelo Instagram', site: 'achar o site de vocês' },
  petshop: { agenda: 'agendar banho e tosa', site: 'achar o site de vocês' },
  academia: { planos: 'ver os planos e horários', aula: 'marcar uma aula experimental' },
  odonto: { agenda: 'marcar uma consulta', site: 'achar o site do consultório' },
  clinica: { agenda: 'marcar uma consulta', site: 'achar o site da clínica' },
  oficina: { orcamento: 'pedir um orçamento', site: 'achar o site de vocês' },
  mercado: { entrega: 'saber se vocês entregam', ofertas: 'ver as ofertas da semana' },
  educacao: { matricula: 'ver os valores e como fazer a matrícula', site: 'achar o site de vocês' },
  generico: { site: 'achar o site de vocês', horario: 'ver o horário de vocês' },
};

export function segmentoTexto(segmento: string | null | undefined) {
  const [plural, um] = SEGMENTO_TEXTO[segmento ?? ''] ?? SEGMENTO_TEXTO.generico;
  return { plural, um };
}

/** "Oi, tudo bem?" + partes, sem espaços sobrando. */
const juntar = (...partes: Array<string | false | null | undefined>) =>
  partes.filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/ ([.,!?])/g, '$1').trim();

/** "o Pet Amigo" -> "do Pet Amigo"; "a Pizzaria X" -> "da Pizzaria X". */
const de = (alvo: string) => alvo.replace(/^o /, 'do ').replace(/^a /, 'da ').replace(/^(?!do |da )/, 'de ');

/** "Só não achei um link..." -> "não achei um link..." (para caber depois de "mas"). */
const semSo = (t: string) => t.trim().replace(/^Só /, '').replace(/^O Instagram está bonito, só /, '').replace(/^\w/, c => c.toLowerCase()).replace(/^não achei/, 'não encontrei').replace(/([^.!?])$/, '$1.');

/** Motivos pelos quais um estilo não pode ser usado agora (vazio = pode). */
export function bloqueioDoEstilo(estilo: string, viu: OQueViu, uf: string | null | undefined): string {
  if (estilo === 'pesquisa' && !viu.observacao) return 'Marque o que você tentou e não achou: a mensagem conta isso.';
  if (estilo === 'cliente' && !viu.observacao) return 'Marque o que você tentou fazer como cliente.';
  if (estilo === 'cliente' && !viu.aconteceu) return 'Confirme que você procurou como cliente de verdade.';
  if (estilo === 'vizinho' && uf && uf !== 'RJ') return 'Só para empresas do Rio: aqui você não é "da região".';
  return '';
}

/**
 * Monta a primeira mensagem no estilo escolhido. Devolve null quando o estilo
 * ainda não pode ser usado (ver bloqueioDoEstilo): o painel mantém o texto.
 */
export function montarMensagem(p: PartesMensagem, viu: OQueViu, segmento: string | null | undefined, uf?: string | null): string | null {
  const estilo = viu.estilo || 'elogio';
  if (bloqueioDoEstilo(estilo, viu, uf)) return null;
  if (estilo === 'elogio') return montarAbertura(p, viu, segmento);

  const { plural, um } = segmentoTexto(segmento);
  const tentativas = TENTATIVAS[segmento ?? ''] ?? TENTATIVAS.generico;
  const onde = ONDE_VIU[viu.onde] ?? 'no Google';
  const faco = p.faco.replace(/\.$/, '');
  const pergunta = maiuscula(p.pergunta);
  const naoGoogle = viu.observacao === 'nao_google';
  const outra = viu.observacao === 'outra' && viu.outra.trim() ? semSo(viu.outra) : '';
  const tentei = tentativas[viu.observacao];

  if (estilo === 'pesquisa') {
    // "Trabalho com X. Estava pesquisando os restaurantes aqui da região no Google e achei..."
    const achado = naoGoogle
      ? `Estava pesquisando ${plural} aqui da região e vi o nome ${de(p.alvo)}, mas não encontrei o perfil de vocês no Google Maps.`
      : outra ? `Estava pesquisando ${plural} aqui da região ${onde} e achei ${p.alvo}, mas ${outra}`
      : `Estava pesquisando ${plural} aqui da região ${onde} e achei ${p.alvo}, mas quando fui ${tentei ?? 'saber mais sobre vocês'}, não consegui.`;
    return juntar('Oi, tudo bem?', p.quem, p.faco, achado, pergunta);
  }

  if (estilo === 'cliente') {
    // Real: ele procurou como cliente. Conta, e logo em seguida diz quem é.
    const tentativa = naoGoogle
      ? `Fui procurar vocês no Google Maps e não encontrei o perfil.`
      : outra ? `Só que ${outra}`
      : `Tentei ${tentei ?? 'saber mais sobre vocês'}, mas não consegui.`;
    return juntar('Oi, tudo bem?', `Estava procurando ${um} aqui perto e achei ${p.alvo}${naoGoogle ? '' : ` ${onde}`}.`, tentativa,
      `Aproveitando: ${p.quem ? p.quem.replace(/^Aqui é/, 'aqui é') : ''}`, p.faco, pergunta);
  }

  if (estilo === 'vizinho') {
    // "sou de Olaria" já vem em p.quem; reforça que é do Rio também.
    const quem = p.quem ? p.quem.replace(/\.$/, ', aqui do Rio também.') : 'Sou aqui do Rio também.';
    return juntar('Oi, tudo bem?', quem, p.faco, `Queria te fazer uma pergunta rápida sobre ${p.alvo}:`, p.pergunta);
  }

  // curta: só a pergunta, e o porquê numa linha.
  const nome = p.quem.replace(/,.*$/, '').replace(/\.$/, '');
  return juntar('Oi, tudo bem?', nome ? `${nome}.` : '', `Pergunta rápida sobre ${p.alvo}: ${p.pergunta}`,
    `Pergunto porque ${faco.replace(/^Trabalho/, 'trabalho')}.`);
}

/**
 * Separa o rodapé de saída que o banco pôs no rascunho (rodape_lgpd): no
 * WhatsApp é a linha "Se não quiser receber..."; no e-mail, o bloco depois
 * de "—". Quem edita mexe só no texto; o rodapé volta inteiro.
 */
export function separarRodape(corpo: string): { texto: string; rodape: string } {
  for (const marca of ['\n\nSe não quiser receber', '\n\n—\n']) {
    const i = corpo.indexOf(marca);
    if (i >= 0) return { texto: corpo.slice(0, i), rodape: corpo.slice(i) };
  }
  return { texto: corpo, rodape: '' };
}
