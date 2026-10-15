"use client";

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Check, LayoutList, LineChart, LogOut, MessageCircle, RefreshCw, Search, Star, UsersRound } from 'lucide-react';
import { criarClienteNavegador } from '@/lib/supabase/client';
import type { DadosPainel, Empresa, Mensagem, Passo } from '@/lib/tipos';
import { diaNoRio } from '@/lib/empresa';
import Ficha from '@/components/ficha';
import Equipe from '@/components/equipe';
import Catalogo from '@/components/catalogo';
import PassoEncontrar from '@/components/passo-encontrar';
import PassoQualificar from '@/components/passo-qualificar';
import PassoContatar from '@/components/passo-contatar';
import PassoAcompanhar from '@/components/passo-acompanhar';
import type { OQueViu } from '@/lib/mensagem';

/**
 * Painel em 4 passos (29/09): Encontrar → Qualificar → Contatar → Acompanhar.
 * Computador: passos no topo. Celular: barra fixa embaixo, como app.
 * Memória e Equipe ficam como telas extras (ícones no topo).
 * O passo atual vive na URL (?passo=), então atualizar a página não perde onde está.
 *
 * 30/09: trocar de passo é instantâneo. Os dados dos 4 passos já chegam na
 * primeira carga; antes, cada clique pedia a página inteira de novo ao
 * servidor (login + 12 consultas), e cliques repetidos enfileiravam pedidos
 * ("clico, clico e demora a mudar"). Agora o clique só troca o que aparece e
 * atualiza a URL no navegador (history.pushState). Só os filtros de
 * Qualificar (canal, busca, página) ainda vão ao servidor, porque a lista é
 * paginada lá.
 */
type Extra = '' | 'memoria' | 'equipe' | 'catalogo';

export default function PainelCliente({ dados: d, email, podeGerenciarEquipe }: { dados: DadosPainel; email: string; podeGerenciarEquipe: boolean }) {
  const router = useRouter();
  const [transicao, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const [extra, setExtra] = useState<Extra>('');
  const [selecionada, selecionar] = useState<Empresa | null>(null);
  const [focoContatar, setFocoContatar] = useState<{ canal: string; mensagem: string }>({ canal: '', mensagem: '' });
  const [passo, setPasso] = useState<Passo>(d.passo);
  const trabalhando = !!ocupado || transicao;

  // Resposta nova do servidor (filtro de Qualificar) manda no passo.
  useEffect(() => { setPasso(d.passo); }, [d.passo]);
  // Voltar/avançar do navegador.
  useEffect(() => {
    const voltar = () => {
      const p = new URLSearchParams(window.location.search).get('passo');
      if (p === 'encontrar' || p === 'qualificar' || p === 'contatar' || p === 'acompanhar') { setPasso(p); setExtra(''); }
    };
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);

  /** Troca de passo na hora, sem ir ao servidor. */
  function ir(novo: Passo, extras: Record<string, string> = {}) {
    setExtra(''); setAviso(''); setErro('');
    setPasso(novo);
    const params = new URLSearchParams({ passo: novo, ...extras });
    if (window.location.search !== `?${params}`) window.history.pushState(null, '', `/?${params}`);
    window.scrollTo({ top: 0 });
  }

  /** Filtros de Qualificar: a lista é paginada no servidor. */
  function filtrarNoServidor(extras: Record<string, string>) {
    setAviso(''); setErro(''); setPasso('qualificar');
    iniciar(() => router.push(`/?${new URLSearchParams({ passo: 'qualificar', ...extras })}`, { scroll: false }));
  }

  async function acao<T = { mensagem?: string }>(rota: string, body: unknown = {}, opcoes: { silencioso?: boolean; atualizar?: boolean } = {}): Promise<T> {
    setOcupado(rota); if (!opcoes.silencioso) { setAviso(''); setErro(''); }
    try {
      const r = await fetch(`/api/actions/${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(result.error ?? 'Não foi possível concluir.');
      if (!opcoes.silencioso) setAviso(result.mensagem ?? 'Salvo.');
      if (opcoes.atualizar !== false) iniciar(() => router.refresh());
      return result as T;
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível concluir.');
      throw err;
    } finally { setOcupado(''); }
  }

  /** Roda a fila até esvaziar (ou 8 rodadas), mostrando o progresso. */
  async function processarFila(progresso?: (t: string) => void) {
    let feitas = 0;
    for (let i = 0; i < 8; i += 1) {
      progresso?.(`Escrevendo mensagens… ${feitas} prontas`);
      const r = await acao<{ processadas: number; erros: string[] }>('rodar-fila', { quantidade: 10 }, { silencioso: true, atualizar: false });
      feitas += r.processadas ?? 0;
      if (!r.processadas || r.erros?.length) break;
    }
    iniciar(() => router.refresh());
    return feitas;
  }

  // Ficha: procura nas listas carregadas; se não achar, busca a empresa.
  async function abrirPorId(id: string) {
    const achada = [...d.empresas, ...d.conversas, ...d.mensagens.map(m => m.empresa).filter(Boolean) as Empresa[]].find(e => e.id === id);
    if (achada) { selecionar(achada); return; }
    try {
      const r = await fetch(`/api/empresas/${id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      selecionar(j.empresa as Empresa);
    } catch { setErro('Não foi possível abrir a ficha dessa empresa.'); }
  }

  async function confirmarWhatsapp(companyId: string, tem: boolean, telefone?: string) {
    const r = await acao<{ refazer: boolean }>('confirmar-whatsapp', { company_id: companyId, tem, telefone: telefone ?? null });
    if (r.refazer) await processarFila().catch(() => {});
  }

  /** "Número errado": sai da empresa e vai para a lista de não contatar. */
  async function descartarTelefone(companyId: string, telefone: string) {
    const r = await acao<{ refazer: boolean }>('descartar-telefone', { company_id: companyId, telefone });
    if (r.refazer) await processarFila().catch(() => {});
  }

  /** "Usar este": outro número conhecido da empresa vira o principal. */
  async function usarTelefone(companyId: string, telefone: string) {
    const r = await acao<{ refazer: boolean }>('usar-telefone', { company_id: companyId, telefone });
    if (r.refazer) await processarFila().catch(() => {});
  }

  const hoje = d.hojeData;
  const contagem: Record<Passo, number> = {
    encontrar: 0,
    qualificar: Object.values(d.funil.canais).reduce((a, b) => a + (b ?? 0), 0),
    contatar: Object.values(d.funil.rascunhos).reduce((a, b) => a + b, 0),
    acompanhar: d.followUps.filter(f => diaNoRio(f.due_at) <= hoje).length,
  };
  const passos: Array<[Passo, string, typeof Search]> = [
    ['encontrar', 'Encontrar', Search], ['qualificar', 'Qualificar', Star],
    ['contatar', 'Contatar', MessageCircle], ['acompanhar', 'Acompanhar', LineChart],
  ];
  const acoesContatar = {
    salvar: async (m: Mensagem, corpo: string, viu: OQueViu | null) => {
      await acao('editar-rascunho', { message_id: m.id, body: corpo, viu }, { silencioso: true });
    },
    usarScript: async (m: Mensagem, templateId: string) => {
      await acao('usar-script', { message_id: m.id, template_id: templateId }, { silencioso: true });
    },
    enviada: async (m: Mensagem) => { await acao('marcar-enviada', { message_id: m.id }); },
    naoContatar: async (m: Mensagem) => { await acao('opt-out', { company_id: m.company_id }); },
    confirmarWhatsapp: (id: string, tem: boolean, telefone?: string) => void confirmarWhatsapp(id, tem, telefone).catch(() => {}),
    usarTelefone: (id: string, telefone: string) => void usarTelefone(id, telefone).catch(() => {}),
    descartarTelefone: (id: string, telefone: string) => void descartarTelefone(id, telefone).catch(() => {}),
    abrir: (id: string) => void abrirPorId(id),
  };

  return <div className="app">
    <header className="topo"><div className="topo-in">
      <a className="marca" href="/"><i>P</i><div>Prospecção<small>RJ e SP</small></div></a>
      <nav className="passos" aria-label="Passos">
        {passos.map(([id, rotulo], i) => <button key={id} type="button" aria-current={!extra && passo === id ? 'page' : undefined} onClick={() => ir(id)}>
          <b>{i + 1}</b>{rotulo}{contagem[id] > 0 && <span className="cont">{contagem[id]}</span>}</button>)}
      </nav>
      <div className="menu-extra">
        {podeGerenciarEquipe && <button type="button" className="icone" aria-pressed={extra === 'catalogo'} title="Catálogo de nichos" onClick={() => setExtra(extra === 'catalogo' ? '' : 'catalogo')}><LayoutList size={17}/><span className="txt">Nichos</span></button>}
        <button type="button" className="icone" aria-pressed={extra === 'memoria'} title="Memória e histórico" onClick={() => setExtra(extra === 'memoria' ? '' : 'memoria')}><BookOpen size={17}/><span className="txt">Memória</span></button>
        {podeGerenciarEquipe && <button type="button" className="icone" aria-pressed={extra === 'equipe'} title="Equipe" onClick={() => setExtra(extra === 'equipe' ? '' : 'equipe')}><UsersRound size={17}/><span className="txt">Equipe</span></button>}
        <button type="button" className="icone" title={`Sair (${email})`} aria-label="Sair da conta" onClick={async () => { await criarClienteNavegador().auth.signOut(); router.push('/login'); }}><LogOut size={17}/></button>
      </div>
    </div></header>

    <main className="conteudo" aria-busy={transicao}>
      {(erro || d.erro) && <p role="alert" className="aviso erro">{erro || d.erro}</p>}
      {aviso && <p role="status" className="aviso sucesso"><Check size={16}/>{aviso}</p>}

      {extra === 'memoria' && <section>
        <div className="cabeca"><div><button type="button" className="voltar" onClick={() => setExtra('')}><ArrowLeft size={16}/> Voltar</button><h1>Memória e histórico</h1></div>
          <button type="button" className="btn btn-p" disabled={trabalhando} onClick={() => void acao('sincronizar').catch(() => {})}><RefreshCw size={16} className={ocupado === 'sincronizar' ? 'girando' : ''}/>{ocupado === 'sincronizar' ? 'Sincronizando…' : 'Sincronizar Obsidian'}</button></div>
        <div className="grade g-2">
          <div className="cartao"><h3>Notas recentes</h3>{d.memoria.length ? d.memoria.map(n => <div className="linha-lista" key={n.vault_path}>
            <span><strong>{n.title}</strong><small className="muted"> {n.vault_path}</small></span>
            <span className={`etapa ${n.sync_status === 'synced' ? 'won' : 'researching'}`}>{({ synced: 'Sincronizado', pending: 'Pendente', conflict: 'Conflito', failed: 'Falha' } as Record<string, string>)[n.sync_status] ?? n.sync_status}</span>
          </div>) : <p className="vazio">Nenhuma nota ainda.</p>}</div>
          <div className="cartao"><h3>Últimas atividades</h3>{d.atividades.map(a => <div className="registro" key={a.id}><small className="muted">{new Date(a.happened_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small><strong>{a.title}</strong>{a.body && <p>{a.body}</p>}</div>)}</div>
        </div>
      </section>}

      {extra === 'equipe' && podeGerenciarEquipe && d.workspaceId && <section>
        <button type="button" className="voltar" onClick={() => setExtra('')}><ArrowLeft size={16}/> Voltar</button>
        <div className="cartao"><Equipe workspaceId={d.workspaceId}/></div>
      </section>}

      {extra === 'catalogo' && podeGerenciarEquipe && <Catalogo nichos={d.catalogo} aoSalvar={() => iniciar(() => router.refresh())}/>}

      {!extra && passo === 'encontrar' && <PassoEncontrar dados={d} ocupado={trabalhando}
        irPara={p => ir(p)}
        buscar={async (corpo, progresso) => {
          try {
            progresso('Buscando no cadastro e no mapa…');
            const r = await acao<{ mensagem: string; novas: number; completadas: number }>('buscar', corpo, { atualizar: false });
            if (r.novas || r.completadas) {
              const feitas = await processarFila(progresso).catch(() => 0);
              setAviso(`${r.mensagem}${feitas ? ` ${feitas} ${feitas === 1 ? 'análise feita' : 'análises feitas'}.` : ''}`);
            } else iniciar(() => router.refresh());
            return r;
          } catch { return null; }
        }}/>}

      {!extra && passo === 'qualificar' && <PassoQualificar dados={d} ocupado={trabalhando}
        filtrar={f => filtrarNoServidor({ ...(f.canal ? { canal: f.canal } : {}), ...(f.q ? { q: f.q } : {}), pagina: String(f.pagina ?? 1) })}
        abrir={id => void abrirPorId(id)}
        preparar={(mensagem, canal) => { setFocoContatar({ canal, mensagem }); ir('contatar', { canal }); }}
        confirmarWhatsapp={(id, tem, telefone) => void confirmarWhatsapp(id, tem, telefone).catch(() => {})}
        usarTelefone={(id, telefone) => void usarTelefone(id, telefone).catch(() => {})}
        descartarTelefone={(id, telefone) => void descartarTelefone(id, telefone).catch(() => {})}
        processarFila={() => void processarFila().then(n => setAviso(n ? `${n} ${n === 1 ? 'análise feita' : 'análises feitas'}.` : 'Nada pendente na fila.')).catch(() => {})}/>}

      {!extra && passo === 'contatar' && <PassoContatar key={`${focoContatar.canal}-${focoContatar.mensagem}`} dados={d} ocupado={trabalhando}
        canalInicial={focoContatar.canal || d.filtro.canal}
        mensagemInicial={focoContatar.mensagem} acoes={acoesContatar}/>}

      {!extra && passo === 'acompanhar' && <PassoAcompanhar dados={d} ocupado={trabalhando}
        abrir={id => void abrirPorId(id)} concluir={id => void acao('concluir-retorno', { id }).catch(() => {})}/>}
    </main>

    <nav className="barra-baixo" aria-label="Passos">
      {passos.map(([id, rotulo, Icone]) => <button key={id} type="button" aria-current={!extra && passo === id ? 'page' : undefined} onClick={() => ir(id)}>
        <span className="ic"><Icone size={20}/>{contagem[id] > 0 && <span className="cont">{contagem[id] > 99 ? '99+' : contagem[id]}</span>}</span>{rotulo}</button>)}
    </nav>

    {selecionada && <Ficha key={selecionada.id} empresa={selecionada} fechar={() => selecionar(null)}
      salvar={async body => { await acao('acompanhamento', body); }}
      salvarDados={async dados => { await acao('editar-empresa', { company_id: selecionada.id, updated_at: selecionada.updated_at, dados }); }}
      bloquear={async () => { await acao('opt-out', { company_id: selecionada.id }); }}
      proposta={async body => { await acao('proposta', body); }}
      confirmarWhatsapp={async (tem, telefone) => { await confirmarWhatsapp(selecionada.id, tem, telefone); }}
      usarTelefone={async telefone => { await usarTelefone(selecionada.id, telefone); }}
      descartarTelefone={async telefone => { await descartarTelefone(selecionada.id, telefone); }}/>}
  </div>;
}
