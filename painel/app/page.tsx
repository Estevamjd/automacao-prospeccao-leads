import { criarClienteServidor } from '@/lib/supabase/server';
import PainelCliente from '@/components/painel-cliente';
import { COLUNAS_EMPRESA, diaNoRio } from '@/lib/empresa';
import type { DadosPainel, Empresa, EmpresaComCanal, Funil, Geografia, Mensagem, Passo, ResultadoComercial, Tarefa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

const PASSOS: Passo[] = ['encontrar', 'qualificar', 'contatar', 'acompanhar'];
const CANAIS = ['whatsapp', 'phone', 'email', 'sem_contato'];
/** Ainda não contatadas: é o que o passo Qualificar mostra. */
const ANTES_DO_CONTATO = ['new', 'researching', 'qualified', 'ready_for_outreach'];
const POR_PAGINA = 20;

type LinhaMensagem = {
  id: string; company_id: string; template_id: string | null; channel: string; status: string;
  subject: string | null; body: string | null; created_at: string;
  companies: Empresa | null;
};

const FUNIL_VAZIO: Funil = {
  etapas: {}, canais: {}, rascunhos: {}, enviadas_hoje: 0, enviadas_total: 0,
  responderam: 0, propostas: {}, nao_contatar: 0, buscas: [],
};

export default async function Painel({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const texto = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
  const passo = (PASSOS as string[]).includes(texto('passo')) ? texto('passo') as Passo : null;
  const canal = CANAIS.includes(texto('canal')) ? texto('canal') : '';
  const busca = texto('q').trim().slice(0, 100);
  const pagina = Math.max(1, Math.min(100000, Math.floor(Number(texto('pagina')) || 1)));

  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: workspace } = await supabase.from('workspaces').select('id,name,owner_id').limit(1).maybeSingle();
  const dados: DadosPainel = {
    passo: passo ?? 'encontrar', filtro: { canal, busca, pagina }, totalFiltrado: 0,
    workspaceId: workspace?.id ?? null, workspaceName: workspace?.name ?? 'Prospecção',
    empresas: [], tarefas: [], hojeData: diaNoRio(new Date()), conversas: [], resultados: [], geografia: [], nichos: [], catalogo: [], buscasSalvas: [], scripts: [], desempenhoScripts: [],
    mensagens: [], estilos: [], funil: FUNIL_VAZIO, followUps: [], propostasAbertas: [], atividades: [], memoria: [],
    resumo: { total: 0, prontos: 0, optOut: 0, tarefasPendentes: 0, revisoesHumanas: 0, tarefasComFalha: 0, scoreMedio: 0, conversas: 0, contratos: 0, valorContratos: 0, rascunhosAbertos: 0, mensagensEnviadas: 0 },
  };

  if (workspace) {
    let qualificar = supabase.from('empresas_painel').select(`${COLUNAS_EMPRESA},canal`, { count: 'exact' })
      .eq('workspace_id', workspace.id).in('status', ANTES_DO_CONTATO).is('opt_out_at', null);
    if (canal) qualificar = qualificar.eq('canal', canal);
    if (busca) qualificar = qualificar.ilike('name', `%${busca.replace(/[\\%_]/g, '\\$&')}%`);

    const resultados = await Promise.all([
      qualificar.order('score', { ascending: false, nullsFirst: false }).order('id').range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
      supabase.rpc('resumo_comercial', { p_workspace: workspace.id }),
      supabase.rpc('funil_painel', { p_workspace: workspace.id }),
      supabase.rpc('geografia_reserva', { p_workspace: workspace.id }),
      supabase.from('niche_playbooks').select('id,slug,label,icone,ordem,is_active,apresentacao,cnaes_principais,cnaes_com_palavra,cnaes_secundarios,google_types,osm_tags,palavras_nome,palavras_excluir,opening_questions,avoid,pains,offers')
        .eq('workspace_id', workspace.id).order('ordem').order('label'),
      supabase.from('buscas_salvas').select('id,nome,filtros')
        .eq('workspace_id', workspace.id).eq('arquivada', false).order('updated_at', { ascending: false }).limit(20),
      supabase.from('message_templates').select('id,name,channel,nicho,etapa,body_template,variaveis_obrigatorias')
        .eq('workspace_id', workspace.id).eq('is_active', true).order('ordem').limit(80),
      supabase.rpc('resultado_por_script', { p_workspace: workspace.id }),
      // Mensagens prontas com a empresa inteira: o modo sequência precisa das
      // peças da abertura, das respostas prontas e dos sinais.
      supabase.from('outreach_messages')
        .select(`id,company_id,template_id,channel,status,subject,body,created_at,companies!outreach_messages_company_workspace_fkey(${COLUNAS_EMPRESA})`)
        .eq('workspace_id', workspace.id).eq('status', 'draft').is('sent_at', null)
        .order('created_at', { ascending: false }).limit(80),
      supabase.from('follow_ups').select('id,due_at,notes,company_id,companies!follow_ups_company_workspace_fkey(name)')
        .eq('workspace_id', workspace.id).eq('status', 'scheduled').order('due_at').limit(100),
      supabase.from('companies').select(COLUNAS_EMPRESA).eq('workspace_id', workspace.id)
        .in('status', ['contacted', 'responded', 'meeting_scheduled']).is('opt_out_at', null)
        .order('updated_at', { ascending: true }).limit(40),
      supabase.from('propostas').select('id,servico,valor,enviada_em,company_id,companies(name)')
        .eq('workspace_id', workspace.id).eq('status', 'enviada').order('enviada_em', { ascending: false }).limit(30),
      supabase.rpc('resultados_comerciais', { p_workspace: workspace.id }),
      supabase.from('agent_tasks').select('id,task_type,status,priority,error_message,attempts')
        .eq('workspace_id', workspace.id).eq('status', 'failed').limit(10),
      supabase.from('activities').select('id,activity_type,title,body,happened_at')
        .eq('workspace_id', workspace.id).order('happened_at', { ascending: false }).limit(30),
      supabase.from('knowledge_notes').select('title,vault_path,sync_status,synced_at')
        .eq('workspace_id', workspace.id).order('updated_at', { ascending: false }).limit(30),
      // Qual jeito de abrir a conversa tem mais resposta (30/09).
      supabase.rpc('resultado_por_estilo', { p_workspace: workspace.id }),
    ]);
    const [empresas, resumo, funil, geografia, nichos, buscasSalvas, scripts, desempenhoScripts, mensagens, followUps, conversas, propostas, comerciais, tarefas, atividades, memoria, estilos] = resultados;

    dados.empresas = (empresas.data ?? []) as unknown as EmpresaComCanal[];
    dados.totalFiltrado = empresas.count ?? 0;
    dados.resumo = { ...dados.resumo, ...(resumo.data as object) };
    dados.funil = { ...FUNIL_VAZIO, ...(funil.data as Funil | null) };
    dados.geografia = (geografia.data ?? []) as Geografia[];
    dados.catalogo = (nichos.data ?? []) as DadosPainel['catalogo'];
    dados.nichos = dados.catalogo.filter(n => n.is_active);
    dados.buscasSalvas = (buscasSalvas.data ?? []) as DadosPainel['buscasSalvas'];
    dados.scripts = (scripts.data ?? []) as DadosPainel['scripts'];
    dados.desempenhoScripts = (desempenhoScripts.data ?? []) as DadosPainel['desempenhoScripts'];
    dados.followUps = (followUps.data ?? []) as unknown as DadosPainel['followUps'];
    dados.conversas = (conversas.data ?? []) as unknown as Empresa[];
    dados.propostasAbertas = (propostas.data ?? []) as unknown as DadosPainel['propostasAbertas'];
    dados.resultados = (comerciais.data ?? []) as ResultadoComercial[];
    dados.tarefas = (tarefas.data ?? []) as Tarefa[];
    dados.atividades = atividades.data ?? [];
    dados.memoria = memoria.data ?? [];
    dados.estilos = (estilos.data ?? []) as DadosPainel['estilos'];
    dados.mensagens = ((mensagens.data ?? []) as unknown as LinhaMensagem[])
      .filter(m => m.body)
      .map((m): Mensagem => ({
        id: m.id, company_id: m.company_id, template_id: m.template_id, channel: m.channel, status: m.status,
        subject: m.subject, body: m.body as string, created_at: m.created_at,
        empresa_nome: m.companies?.name ?? 'Empresa removida',
        empresa_telefone: m.companies?.main_phone ?? null,
        empresa_opt_out: m.companies?.opt_out_at ?? null,
        empresa_cidade: m.companies?.city ?? null,
        segunda_mensagem: m.channel === 'phone' ? null : m.companies?.advisor_brief?.segunda_mensagem ?? null,
        empresa: m.companies,
      }))
      // Maior prioridade primeiro: é a ordem do modo sequência.
      .sort((a, b) => (b.empresa?.score ?? 0) - (a.empresa?.score ?? 0));

    // Sem passo na URL: abre onde há trabalho (mensagem pronta > a qualificar > buscar).
    if (!passo) {
      const prontas = Object.values(dados.funil.rascunhos).reduce((a, b) => a + b, 0);
      const aQualificar = Object.values(dados.funil.canais).reduce((a, b) => a + (b ?? 0), 0);
      dados.passo = prontas ? 'contatar' : aQualificar ? 'qualificar' : 'encontrar';
    }

    // Erro de consulta nunca vira estado vazio silencioso: lista vazia por
    // falha é indistinguível de "não há nada". Identificar a fonte nos logs
    // permite corrigir sem expor detalhes do banco na tela.
    const fontes = ['qualificar', 'resumo', 'funil', 'geografia', 'nichos', 'buscas salvas',
      'roteiros', 'desempenho de roteiros', 'rascunhos', 'retornos', 'conversas',
      'propostas', 'resultados', 'tarefas', 'atividades', 'memória', 'estilos'];
    resultados.forEach((r, i) => {
      if (r.error) console.error('Painel: consulta falhou', fontes[i], r.error.code, r.error.message);
    });
    if (resultados.some(r => r.error)) dados.erro = 'Alguns dados não puderam ser carregados. Atualize a página para tentar novamente.';
  } else dados.erro = 'Não foi possível carregar seu espaço de trabalho.';

  return <PainelCliente dados={dados} email={user?.email ?? ''} podeGerenciarEquipe={!!workspace && workspace.owner_id === user?.id} />;
}
