import type { Brief } from './tipos';

type Plano = { entrega: string; pergunta: string };

const PLANOS: Array<{ codigos: string[]; plano: Plano }> = [
  { codigos: ['presenca_google', 'presenca_basica'], plano: {
    entrega: 'verificar se já existe um Perfil da Empresa no Google e organizar horário, serviços, fotos e contato com o proprietário',
    pergunta: 'Vocês já administram um perfil no Google ou nunca criaram um?',
  } },
  { codigos: ['agendamento_online', 'agendamento_link', 'agenda_banho', 'reserva_whatsapp', 'reserva_mesa', 'confirmacao_horario'], plano: {
    entrega: 'montar um fluxo de agendamento com horários disponíveis e confirmação para o cliente',
    pergunta: 'Como vocês controlam os horários e confirmam as reservas hoje?',
  } },
  { codigos: ['cardapio_whatsapp', 'cardapio_link', 'cardapio_digital', 'pedido_bairro', 'pedido_whatsapp'], plano: {
    entrega: 'montar um cardápio em link com caminho claro para fazer o pedido pelo WhatsApp',
    pergunta: 'Vocês já têm cardápio em PDF, fotos ou algum link atualizado?',
  } },
  { codigos: ['atendimento_whatsapp', 'atendente_pico', 'orcamento_whatsapp'], plano: {
    entrega: 'organizar as perguntas e respostas mais frequentes no WhatsApp, com passagem para uma pessoa quando necessário',
    pergunta: 'Em que momento o atendimento ou o orçamento mais demora hoje?',
  } },
  { codigos: ['confirmacao_consulta', 'lembrete_recorrencia', 'lembrete_revisao', 'retorno_periodico', 'encaixe_ultima_hora', 'lembrete_corte', 'lembrete_sessao'], plano: {
    entrega: 'organizar lembretes e confirmações para clientes que já se relacionam com vocês',
    pergunta: 'Onde vocês registram os contatos e como combinam o retorno com os clientes?',
  } },
  { codigos: ['recuperar_clientes', 'reativacao_pacientes', 'retomada_tratamento', 'follow_matricula'], plano: {
    entrega: 'organizar um acompanhamento individual de quem já procurou vocês, respeitando quem não quiser receber contato',
    pergunta: 'Vocês já têm uma lista atualizada de pessoas que pediram retorno?',
  } },
  { codigos: ['conteudo_instagram', 'agenda_eventos', 'lista_ofertas', 'promocao_dia_fraco'], plano: {
    entrega: 'planejar uma rotina simples de divulgação com conteúdo e chamadas para contato',
    pergunta: 'Quem cuida da divulgação hoje e com que frequência vocês conseguem publicar?',
  } },
  { codigos: ['pagina_matricula', 'aula_experimental', 'vitrine_link', 'pagina_servicos'], plano: {
    entrega: 'criar uma página simples para receber interessados e organizar o retorno da equipe',
    pergunta: 'Como os interessados chegam e quem responde depois do primeiro contato?',
  } },
  { codigos: ['fidelidade_simples', 'alerta_evasao', 'plano_mensal', 'controle_pacotes'], plano: {
    entrega: 'organizar um acompanhamento dos clientes atuais e dos sinais de que precisam de atenção',
    pergunta: 'Vocês já acompanham frequência ou compras em algum sistema?',
  } },
];

export function montarContinuacao(brief: Brief | null, contextoMaps = false) {
  const codigo = brief?.oferta_principal?.codigo ?? '';
  const plano = contextoMaps ? PLANOS[0].plano : PLANOS.find(p => p.codigos.includes(codigo))?.plano;
  const entrega = plano?.entrega ?? (brief?.oferta_principal?.titulo
    ? `definir as entregas de ${brief.oferta_principal.titulo.toLocaleLowerCase('pt-BR')}`
    : 'entender a necessidade de vocês e montar uma proposta objetiva');
  const pergunta = plano?.pergunta ?? 'Qual é a maior dificuldade de vocês hoje nesse processo?';

  return {
    interesse: `Legal! Para vocês, eu começaria por ${entrega}. Antes de te passar o escopo, prazo e valor, preciso entender uma coisa: ${pergunta}`,
    aceite: 'Perfeito. Vou registrar por escrito o que combinamos: entregas, valor, prazo e início. Depois que você confirmar esse resumo, combinamos os acessos necessários por convite, sem compartilhar senhas. Qual e-mail devo usar para enviar?',
  };
}
