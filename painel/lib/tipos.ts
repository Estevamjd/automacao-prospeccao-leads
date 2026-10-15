export type Oferta = {
  codigo: string;
  titulo: string;
  porque: string;
  pitch: string;
  esforco: "baixo" | "medio" | "alto";
  impacto: "alto" | "medio" | "baixo";
  prazo?: string;
  faixa_preco?: string;
};

/** Peças da abertura (advisor desde 29/09). Brief antigo não tem. */
export type PartesMensagem = {
  quem: string;
  faco: string;
  alvo: string;
  onde: string;
  pergunta: string;
  oferta: string;
  faixa_preco: string;
};

export type RespostaPronta = {
  situacao: string;
  resposta: string;
  depois?: 'nao_contatar' | 'agendar_retorno' | 'mandar_exemplo';
};

export type Brief = {
  segmento: string;
  /** Chave do playbook (beleza, pizzaria...). Null = genérico. */
  playbook_slug?: string | null;
  /** Desde 29/09. */
  partes?: PartesMensagem;
  /** Desde 29/09. */
  respostas_prontas?: RespostaPronta[];
  confianca: number;
  diagnostico: Array<{ codigo: string; texto: string; gravidade: string }>;
  oferta_principal: Oferta | null;
  alternativas: Oferta[];
  abertura: string;
  /** Desde 23/09. Briefs antigos nao tem: sempre tratar como opcional. */
  segunda_mensagem?: string;
  /** Desde 23/09. Roteiro para telefone fixo. */
  roteiro_ligacao?: string;
  o_que_evitar: string[];
  proximo_passo: string;
  resumo_amigo: string;
};

export type ConfirmacaoManual = {
  original: string | null;
  confirmed_at: string;
  confirmed_by?: string | null;
};

export type Empresa = {
  main_email: string | null;
  instagram_url: string | null;
  outcome_reason: string | null;
  /** Campos que voce conferiu na mao. Preenchido por salvar_dados_empresa. */
  manual_overrides: Record<string, ConfirmacaoManual> | null;
  address_line: string | null;
  data_source_url: string | null;
  data_collected_at: string | null;
  metadata: MetadadosEmpresa | null;
  signals: Record<string, boolean | string | number | null> | null;
  id: string;
  name: string;
  status: string;
  score: number | null;
  city: string | null;
  state: string | null;
  category: string | null;
  main_phone: string | null;
  website_url: string | null;
  fit_summary: string | null;
  recommended_offer: string | null;
  advisor_brief: Brief | null;
  opt_out_at: string | null;
  updated_at: string;
};

export type MetadadosEmpresa = {
  comercial?: { valor: number | null; data: string | null; servico: string };
  fonte?: string;
  cnpj?: string;
  /** Desde 29/09: de onde vieram os dados ("cnpj", "mapa"). */
  fontes?: string[];
  inicio_atividade?: string | null;
  bairro?: string | null;
  zona?: string | null;
  /** Todos os números conhecidos (dígitos com DDD), de todas as fontes. */
  telefones?: string[];
  /** Celulares que ganharam o nono dígito pela regra da Anatel (01/10). */
  telefones_inferidos?: string[];
  /** Resultado do teste de WhatsApp por número: {"2133334444": true}. */
  whatsapp_numeros?: Record<string, boolean>;
  /** id de outra empresa com nome muito parecido na mesma cidade. */
  possivel_duplicata?: string;
  observacoes?: Record<string, unknown>;
};

/** Linha da view empresas_painel: a empresa + o canal indicado. */
export type EmpresaComCanal = Empresa & { canal: Canal };
export type Canal = 'whatsapp' | 'phone' | 'email' | 'sem_contato';

/**
 * Rascunho de abordagem pronto para envio.
 *
 * O painel nao carregava outreach_messages: as mensagens eram escritas e
 * ficavam invisiveis, so alcancaveis pelo SQL Editor. Sem isso, sent_at nunca
 * era preenchido e toda a metade de tras do funil (follow-up, resposta,
 * desempenho) ficava morta.
 */
export type Mensagem = {
  id: string;
  template_id: string | null;
  company_id: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string;
  created_at: string;
  empresa_nome: string;
  empresa_telefone: string | null;
  empresa_opt_out: string | null;
  empresa_cidade: string | null;
  /** O que mandar se a pessoa responder a abertura. Null em ligacao e em brief antigo. */
  segunda_mensagem: string | null;
  /** A empresa inteira, para o modo sequência (o que você viu, respostas prontas). */
  empresa: Empresa | null;
};

export type Funil = {
  etapas: Record<string, number>;
  canais: Partial<Record<Canal, number>>;
  rascunhos: Record<string, number>;
  enviadas_hoje: number;
  enviadas_total: number;
  responderam: number;
  propostas: Record<string, number>;
  nao_contatar: number;
  buscas: Array<{ nome: string; criada_em: string; trazidas: number }>;
};

/** Linha de geografia_reserva: onde há empresas no cadastro ainda não trazidas. */
export type Geografia = { uf: string; municipio: string; zona: string | null; disponiveis: number; com_celular: number };

export type Nicho = { slug: string; label: string; icone: string | null; ordem: number };
export type NichoDetalhe = Nicho & {
  id: string; is_active: boolean; apresentacao: string | null;
  cnaes_principais: string[]; cnaes_com_palavra: string[]; cnaes_secundarios: string[];
  google_types: string[]; osm_tags: Array<{ chave: string; valores: string[] }>;
  palavras_nome: string[]; palavras_excluir: string[];
  opening_questions: string[]; avoid: string[];
  pains: Array<{ codigo: string; texto: string; gravidade: string; quando?: Record<string, unknown> }>;
  offers: Array<{ codigo: string; titulo: string; porque: string; pitch: string; esforco: string; impacto: string; prazo?: string; faixa_preco?: string; resolve?: string[]; nivel?: string }>;
};
export type BuscaSalva = { id: string; nome: string; filtros: Record<string, unknown> };
export type ScriptTemplate = { id: string; name: string; channel: string; nicho: string | null;
  etapa: string | null; body_template: string; variaveis_obrigatorias: string[] | null };
export type DesempenhoScript = { nicho: string; estilo: string; modelo: string; enviadas: number;
  responderam: number; positivas: number; amostra_pequena: boolean };

export type Passo = 'encontrar' | 'qualificar' | 'contatar' | 'acompanhar';

export type ResultadoComercial = {
  etapa: string;
  motivo: string;
  segmento: string;
  quantidade: number;
};

export type Tarefa = {
  id: string;
  task_type: string;
  status: string;
  priority: number;
  error_message: string | null;
  attempts: number;
};

export type DadosPainel = {
  passo: Passo;
  /** Filtros do passo Qualificar (vêm da URL). */
  filtro: { canal: string; busca: string; pagina: number };
  totalFiltrado: number;
  workspaceId: string | null;
  workspaceName: string;
  /** Empresas ainda não contatadas (passo Qualificar), já com o canal. */
  empresas: EmpresaComCanal[];
  tarefas: Tarefa[];
  /** Data de hoje no fuso do Rio, no formato AAAA-MM-DD. */
  hojeData: string;
  conversas: Empresa[];
  resultados: ResultadoComercial[];
  /** Resposta por jeito de abrir a conversa (30/09). */
  estilos: Array<{ estilo: string; contatadas: number; responderam: number }>;
  geografia: Geografia[];
  nichos: Nicho[];
  catalogo: NichoDetalhe[];
  buscasSalvas: BuscaSalva[];
  scripts: ScriptTemplate[];
  desempenhoScripts: DesempenhoScript[];
  mensagens: Mensagem[];
  funil: Funil;
  followUps: Array<{ id: string; due_at: string; notes: string | null; company_id: string; companies?: { name: string } | null }>;
  propostasAbertas: Array<{ id: string; servico: string; valor: number | null; enviada_em: string; company_id: string; companies?: { name: string } | null }>;
  atividades: Array<{ id: string; activity_type: string; title: string; body: string | null; happened_at: string }>;
  memoria: Array<{ title: string; vault_path: string; sync_status: string; synced_at: string | null }>;
  resumo: {
    conversas: number;
    contratos: number;
    valorContratos: number;
    total: number;
    prontos: number;
    optOut: number;
    tarefasPendentes: number;
    revisoesHumanas: number;
    tarefasComFalha: number;
    scoreMedio: number;
    rascunhosAbertos: number;
    mensagensEnviadas: number;
  };
  erro?: string;
};

/** Proposta enviada a uma empresa (I6 fase 1). As regras vivem no banco. */
export type Proposta = {
  id: string;
  servico: string;
  valor: number | null;
  status: 'enviada' | 'aprovada' | 'recusada' | 'expirada';
  motivo: string | null;
  observacao: string | null;
  enviada_em: string;
  validade: string | null;
  decidida_em: string | null;
};
