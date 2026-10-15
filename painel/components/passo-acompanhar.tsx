"use client";

import { ArrowRight, CalendarDays, Check, MessageSquare } from 'lucide-react';
import type { DadosPainel } from '@/lib/tipos';
import { diaNoRio } from '@/lib/empresa';
import { moeda } from '@/lib/comercial';
import { Ajuda } from '@/components/ui';
import { ESTILOS } from '@/lib/mensagem';

/**
 * Passo 4 · Acompanhar: funil, retornos (atrasados em destaque), quem está
 * esperando resposta registrada, propostas abertas e por que ganhou/perdeu.
 */
function quando(due: string, hoje: string) {
  const dia = diaNoRio(due);
  if (dia < hoje) {
    const dias = Math.round((new Date(`${hoje}T12:00:00`).getTime() - new Date(`${dia}T12:00:00`).getTime()) / 86400000);
    return { texto: `atrasado ${dias} ${dias === 1 ? 'dia' : 'dias'}`, classe: 'atrasado' };
  }
  if (dia === hoje) return { texto: 'hoje', classe: 'hoje' };
  return { texto: new Date(due).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }), classe: 'muted' };
}

export default function PassoAcompanhar({ dados: d, ocupado, abrir, concluir }: {
  dados: DadosPainel; ocupado: boolean; abrir: (id: string) => void; concluir: (id: string) => void;
}) {
  const e = d.funil.etapas;
  const soma = (...k: string[]) => k.reduce((a, x) => a + (e[x] ?? 0), 0);
  const base = Object.values(e).reduce((a, b) => a + b, 0);
  const contatadas = soma('contacted', 'responded', 'meeting_scheduled', 'won', 'lost');
  const responderam = Math.max(soma('responded', 'meeting_scheduled', 'won'), d.funil.responderam);
  const propostas = Object.values(d.funil.propostas).reduce((a, b) => a + b, 0);
  const etapas: Array<[string, number, string]> = [
    ['Na base', base, 'Todas as empresas, menos quem pediu para não ser contatado.'],
    ['Prontas', soma('ready_for_outreach'), 'Aprovadas pelas regras, com mensagem pronta, ainda não contatadas.'],
    ['Contatadas', contatadas, 'Mensagem enviada ou ligação feita.'],
    ['Responderam', responderam, 'Responderam, marcaram conversa ou fecharam.'],
    ['Propostas', propostas, 'Propostas registradas (qualquer situação).'],
    ['Fecharam', soma('won'), 'Contratos fechados.'],
  ];
  const taxa = contatadas ? Math.round((responderam / contatadas) * 100) : 0;

  return <section aria-labelledby="titulo-acompanhar">
    <div className="cabeca"><div><h1 id="titulo-acompanhar">Acompanhar</h1><p>Quem respondeu, quem precisa de retorno e o que virou proposta.</p></div></div>
    <div className="grade g-2">
      <div className="grade coluna">
        <div className="cartao">
          <h3>Funil</h3>
          <div className="funil">{etapas.map(([rotulo, n, ajuda]) => <div className="etapa-funil" key={rotulo}>
            <span>{rotulo} <Ajuda texto={ajuda}/></span>
            <div className="b"><i style={{ width: `${base ? Math.max((n / base) * 100, n ? 1.5 : 0) : 0}%` }}/></div>
            <strong>{n.toLocaleString('pt-BR')}</strong>
          </div>)}</div>
          <p className="muted">Taxa de resposta: {taxa}% · Valor fechado: {moeda(d.resumo.valorContratos)}{d.funil.nao_contatar ? ` · ${d.funil.nao_contatar} pediram para não ser contatados` : ''}</p>
        </div>
        <div className="cartao">
          <h3><MessageSquare size={18}/> Esperando resposta</h3>
          <p className="muted">Contatadas, mais antigas primeiro. Respondeu? Abra e registre: é o que move o funil.</p>
          {d.conversas.length ? d.conversas.map(c => <div className="linha-lista" key={c.id}>
            <span><strong>{c.name}</strong><small className="muted"> desde {new Date(c.updated_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small></span>
            <button type="button" className="btn btn-s pequeno" disabled={ocupado} onClick={() => abrir(c.id)}>Registrar <ArrowRight size={14}/></button>
          </div>) : <p className="vazio">Ninguém esperando resposta.</p>}
        </div>
      </div>
      <div className="grade coluna">
        <div className="cartao">
          <h3><CalendarDays size={18}/> Retornos</h3>
          {d.followUps.length ? d.followUps.map(f => {
            const q = quando(f.due_at, d.hojeData);
            return <div className="linha-lista" key={f.id}>
              <span><strong>{f.companies?.name ?? 'Empresa'}</strong>{f.notes && <small className="muted"> · {f.notes}</small>}</span>
              <span className="acoes"><span className={q.classe}>{q.texto}</span>
                <button type="button" className="icone" aria-label="Concluir retorno" title="Concluir retorno" disabled={ocupado} onClick={() => concluir(f.id)}><Check size={16}/></button>
                <button type="button" className="icone" aria-label="Abrir ficha" title="Abrir ficha" disabled={ocupado} onClick={() => abrir(f.company_id)}><ArrowRight size={16}/></button></span>
            </div>;
          }) : <p className="vazio">Nenhum retorno agendado.</p>}
        </div>
        <div className="cartao">
          <h3>Propostas abertas</h3>
          {d.propostasAbertas.length ? d.propostasAbertas.map(p => <button type="button" className="linha-lista clicavel" key={p.id} onClick={() => abrir(p.company_id)}>
            <span>{p.servico} · {p.companies?.name ?? 'Empresa'}</span><strong>{p.valor != null ? moeda(p.valor) : 'a definir'}</strong>
          </button>) : <p className="vazio">Nenhuma proposta aguardando resposta.</p>}
        </div>
        <div className="cartao">
          <h3>Qual abertura funciona <Ajuda texto="Por jeito de abrir a conversa (escolhido no passo Contatar): quantas empresas foram contatadas e quantas responderam. Com menos de 20 por estilo, a diferença ainda pode ser sorte."/></h3>
          {d.estilos.length ? d.estilos.map(x => {
            const taxa = x.contatadas ? Math.round((x.responderam / x.contatadas) * 100) : 0;
            return <div className="linha-lista" key={x.estilo}>
              <span><strong>{ESTILOS[x.estilo]?.rotulo ?? (x.estilo === 'regras' ? 'Texto automático' : x.estilo)}</strong><small className="muted"> · {x.contatadas} contatadas{x.contatadas < 20 ? ' (poucas ainda)' : ''}</small></span>
              <strong>{taxa}% responderam</strong>
            </div>;
          }) : <p className="vazio">Aparece depois das primeiras mensagens enviadas.</p>}
        </div>
        <div className="cartao">
          <h3>Modelos usados</h3>
          {d.desempenhoScripts.length ? d.desempenhoScripts.map(x => <div className="linha-lista" key={`${x.nicho}-${x.estilo}-${x.modelo}`}>
            <span><strong>{x.modelo}</strong><small className="muted"> · {x.nicho} · {x.enviadas} enviadas{x.amostra_pequena ? ' (amostra pequena)' : ''}</small></span>
            <strong>{x.enviadas ? Math.round(x.responderam / x.enviadas * 100) : 0}% responderam</strong>
          </div>) : <p className="vazio">Aparece quando você registrar contatos feitos com um modelo.</p>}
        </div>
        <div className="cartao">
          <h3>Por que fechou ou não</h3>
          {d.resultados.length ? d.resultados.map(r => <div className="linha-lista" key={`${r.etapa}-${r.motivo}-${r.segmento}`}>
            <span>{r.motivo} <small className="muted">· {r.segmento}</small></span>
            <span className={`etapa ${r.etapa}`}>{r.quantidade} {r.etapa === 'won' ? 'fechados' : 'não fechados'}</span>
          </div>) : <p className="vazio">Os motivos aparecem quando você registrar ganhos e perdas.</p>}
        </div>
        {d.tarefas.length > 0 && <div className="cartao">
          <h3>Falhas na análise</h3>
          {d.tarefas.map(t => <p key={t.id} className="aviso erro pequeno">{t.error_message ?? 'Tarefa com falha'} · {t.attempts} tentativas</p>)}
        </div>}
      </div>
    </div>
  </section>;
}
