"use client";

import { useState } from 'react';
import { Check, X, Clock, FilePlus2, LoaderCircle } from 'lucide-react';
import { MOTIVOS, dataLocal, moeda } from '@/lib/comercial';
import type { Proposta } from '@/lib/tipos';

/**
 * Aba "Propostas" da ficha (I6 fase 1).
 *
 * Registrar o que foi oferecido e o que o cliente decidiu. Aprovar leva a
 * empresa para "Contrato fechado" (valor = soma das aprovadas); a ultima
 * recusa leva para "Nao fechou". Tudo vira historico e chega a nota da
 * empresa no Obsidian. Quem decide essas regras e o banco (decidir_proposta);
 * esta tela so coleta os dados.
 */
const ROTULO: Record<Proposta['status'], { texto: string; classe: string }> = {
  enviada: { texto: 'Aguardando resposta', classe: 'contacted' },
  aprovada: { texto: 'Aprovada', classe: 'won' },
  recusada: { texto: 'Recusada', classe: 'lost' },
  expirada: { texto: 'Sem resposta', classe: 'rejected' },
};

type Decisao = 'aprovada' | 'recusada';

function Decidir({ proposta, decisao, enviar, cancelar, ocupado }: {
  proposta: Proposta; decisao: Decisao; ocupado: boolean;
  enviar: (corpo: unknown) => Promise<void>; cancelar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [data, setData] = useState('');
  const sugestoes = MOTIVOS[decisao === 'aprovada' ? 'won' : 'lost'];
  return <form className="decidir-proposta" onSubmit={async ev => {
    ev.preventDefault();
    await enviar({ acao: 'decidir', proposta_id: proposta.id, decisao, motivo: motivo.trim(), data: data || null });
  }}>
    <label>{decisao === 'aprovada' ? 'Por que aprovou?' : 'Por que recusou?'} *
      <input required maxLength={200} value={motivo} onChange={ev => setMotivo(ev.target.value)} placeholder="Escolha uma sugestão ou escreva"/>
    </label>
    <div className="sugestoes">{sugestoes.map(x => <button type="button" key={x} className={motivo === x ? 'ativa' : ''} onClick={() => setMotivo(x)}>{x}</button>)}</div>
    {decisao === 'aprovada' && <label>Data do contrato<input type="date" value={data} onChange={ev => setData(ev.target.value)}/><small className="muted">Em branco: hoje.</small></label>}
    <div className="acoes">
      <button className="botao" type="submit" disabled={ocupado}>{ocupado ? <LoaderCircle size={16} className="girando"/> : <Check size={16}/>} {decisao === 'aprovada' ? 'Confirmar aprovação' : 'Confirmar recusa'}</button>
      <button className="botao secundario" type="button" disabled={ocupado} onClick={cancelar}>Cancelar</button>
    </div>
  </form>;
}

export default function Propostas({ propostas, carregando, bloqueada, sugestaoServico, enviar }: {
  propostas: Proposta[]; carregando: boolean; bloqueada: boolean; sugestaoServico: string;
  enviar: (corpo: unknown) => Promise<void>;
}) {
  const [nova, setNova] = useState(false);
  const [servico, setServico] = useState(sugestaoServico);
  const [valor, setValor] = useState('');
  const [validade, setValidade] = useState('');
  const [observacao, setObservacao] = useState('');
  const [decidindo, setDecidindo] = useState<{ id: string; decisao: Decisao } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function executar(corpo: unknown) {
    setOcupado(true);
    try { await enviar(corpo); } finally { setOcupado(false); }
  }

  const abertas = propostas.filter(p => p.status === 'enviada').length;

  return <>
    <div className="titulo-linha"><h3>Propostas</h3>{!bloqueada && !nova && <button className="botao" onClick={() => setNova(true)}><FilePlus2 size={16}/> Registrar proposta</button>}</div>
    <p className="muted">Aprovar leva a empresa para “Contrato fechado”. Recusar a última proposta em aberto leva para “Não fechou”. Tudo vai para o histórico e para a nota no Obsidian.</p>

    {nova && <form className="nova-proposta" onSubmit={async ev => {
      ev.preventDefault();
      await executar({ acao: 'registrar', servico: servico.trim(), valor: valor === '' ? null : Number(valor), validade: validade || null, observacao: observacao.trim() || null });
    }}>
      <fieldset disabled={ocupado}>
        <div className="form-grid">
          <label>Serviço *<input required minLength={2} maxLength={300} value={servico} onChange={ev => setServico(ev.target.value)} placeholder="Ex.: agendamento online"/></label>
          <label>Valor (R$)<input type="number" min="0" max="999999999" step="0.01" value={valor} onChange={ev => setValor(ev.target.value)} placeholder="Não informado"/></label>
          <label>Válida até<input type="date" value={validade} onChange={ev => setValidade(ev.target.value)}/></label>
        </div>
        <label>Observação<textarea rows={2} maxLength={2000} value={observacao} onChange={ev => setObservacao(ev.target.value)} placeholder="Condições, prazo, como foi enviada…"/></label>
        <div className="acoes">
          <button className="botao" type="submit">{ocupado ? <LoaderCircle size={16} className="girando"/> : <FilePlus2 size={16}/>} Registrar</button>
          <button className="botao secundario" type="button" onClick={() => setNova(false)}>Cancelar</button>
        </div>
      </fieldset>
    </form>}

    {carregando ? <p>Carregando…</p> : propostas.length === 0
      ? <p className="vazio">Nenhuma proposta registrada ainda.</p>
      : propostas.map(p => <article className="registro proposta" key={p.id}>
          <div className="titulo-linha">
            <strong>{p.servico}</strong>
            <span className={`etapa ${ROTULO[p.status].classe}`}>{ROTULO[p.status].texto}</span>
          </div>
          <small>{p.valor != null ? moeda(Number(p.valor)) : 'Valor não informado'} · enviada em {dataLocal(p.enviada_em)}{p.validade ? ` · válida até ${dataLocal(p.validade)}` : ''}{p.decidida_em ? ` · decidida em ${dataLocal(p.decidida_em)}` : ''}</small>
          {p.observacao && <p>{p.observacao}</p>}
          {p.motivo && <p><em>Motivo:</em> {p.motivo}</p>}
          {p.status === 'enviada' && !bloqueada && (decidindo?.id === p.id
            ? <Decidir proposta={p} decisao={decidindo.decisao} ocupado={ocupado} enviar={executar} cancelar={() => setDecidindo(null)}/>
            : <div className="acoes">
                <button className="botao secundario" disabled={ocupado} onClick={() => setDecidindo({ id: p.id, decisao: 'aprovada' })}><Check size={16}/> Aprovou</button>
                <button className="botao secundario" disabled={ocupado} onClick={() => setDecidindo({ id: p.id, decisao: 'recusada' })}><X size={16}/> Recusou</button>
                <button className="botao secundario" disabled={ocupado} onClick={() => { if (confirm('Marcar esta proposta como sem resposta? A etapa da empresa não muda.')) void executar({ acao: 'decidir', proposta_id: p.id, decisao: 'expirada' }).catch(() => {}); }}><Clock size={16}/> Sem resposta</button>
              </div>)}
        </article>)}
    {abertas > 1 && <small className="muted">{abertas} propostas aguardando resposta.</small>}
  </>;
}
