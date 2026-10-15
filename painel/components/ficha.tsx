"use client";

import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, Phone, FileCheck2, Save, LoaderCircle } from 'lucide-react';
import { ETAPAS, MOTIVOS, dataLocal, urlSegura, telefoneWhatsapp, linkLigar } from '@/lib/comercial';
import { formatarCnpj } from '@/lib/cnpj';
import { fontesDe } from '@/lib/qualificar';
import type { Empresa, Proposta } from '@/lib/tipos';
import DadosEmpresa from '@/components/dados-empresa';
import Propostas from '@/components/propostas';
import Continuacao from '@/components/continuacao';
import { Ajuda, AcharWhatsapp, BotaoCopiar, ListaTelefones, TestarWhatsapp } from '@/components/ui';
import { telefonesDe } from '@/lib/telefones';

/**
 * Ficha da empresa (modal). Mesma do painel antigo, com o que mudou em 29/09:
 * fontes dos dados (CNPJ, mapa), "Testar WhatsApp no fixo" e respostas prontas.
 */
type Historico = { id: string; title: string; body: string | null; happened_at: string; metadata: { de?: string; para?: string } };
type Evidencia = { id: string; title: string | null; source_url: string | null; extracted_text: string | null; observed_at: string };

export default function Ficha({ empresa: e, fechar, salvar, salvarDados, bloquear, proposta, confirmarWhatsapp, usarTelefone, descartarTelefone }: { empresa: Empresa; fechar: () => void; salvar: (corpo: unknown) => Promise<void>; salvarDados: (dados: Record<string,string>) => Promise<void>; bloquear: () => Promise<void>; proposta: (corpo: unknown) => Promise<void>; confirmarWhatsapp: (tem: boolean, telefone?: string) => Promise<void>; usarTelefone: (telefone: string) => Promise<void>; descartarTelefone: (telefone: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [aba, setAba] = useState('dados');
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [etapa, setEtapa] = useState(e.status);
  const [nota, setNota] = useState('');
  const [valor, setValor] = useState(e.metadata?.comercial?.valor?.toString() ?? '');
  const [data, setData] = useState(e.metadata?.comercial?.data ?? '');
  const [servico, setServico] = useState(e.metadata?.comercial?.servico ?? '');
  const [retorno, setRetorno] = useState('');
  const [motivo, setMotivo] = useState(e.outcome_reason ?? '');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/empresas/${e.id}`, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('Não foi possível carregar as fontes e o histórico.');
      return r.json();
    }).then(d => { setHistorico(d.historico); setEvidencias(d.evidencias); setPropostas(d.propostas ?? []); }).catch(err => { if (err.name !== 'AbortError') setErro(err.message); }).finally(() => setCarregando(false));
    return () => controller.abort();
  }, [e.id]);
  const brief = e.advisor_brief;
  const fonte = urlSegura(e.data_source_url);
  const whatsapp = telefoneWhatsapp(e.main_phone);
  const ligar = linkLigar(e.main_phone);
  const pedeMotivo = etapa === 'won' || etapa === 'lost';
  return <dialog ref={dialog} className="ficha" onCancel={event => { event.preventDefault(); if (!enviando) fechar(); }} aria-labelledby="nome-empresa">
    <header className="ficha-topo"><div><span className={`etapa ${e.status}`}>{ETAPAS[e.status]}</span><h2 id="nome-empresa">{e.name}</h2><p>{brief?.segmento ?? e.category ?? 'Segmento não informado'} · {e.city ?? 'Cidade não informada'}{formatarCnpj(e.metadata?.cnpj) && ` · CNPJ ${formatarCnpj(e.metadata?.cnpj)}`}{` · dados: ${fontesDe(e)}`}</p></div><button className="icone" aria-label="Fechar ficha" disabled={enviando} onClick={fechar}><X /></button></header>
    <nav className="abas" aria-label="Ficha da empresa">{[['dados','Dados encontrados'],['proposta','Oportunidade'],['propostas','Propostas'],['andamento','Andamento']].map(([id, nome]) => <button key={id} onClick={() => setAba(id)} aria-current={aba === id ? 'page' : undefined}>{nome}</button>)}</nav>
    <div className="ficha-corpo">
      {erro && <p role="alert" className="aviso erro">{erro}</p>}
      {aba === 'dados' && <>
        {!e.opt_out_at && telefonesDe(e).length > 0 && <><h3>Números de contato <Ajuda texto="Todos os números que o cadastro de CNPJ e o mapa trouxeram. A estrela é o principal: é para ele que a mensagem vai."/></h3>
          <ListaTelefones telefones={telefonesDe(e)} ocupado={enviando}
            confirmar={async (t, tem) => { setEnviando(true); try { await confirmarWhatsapp(tem, t); fechar(); } catch { setErro('Não foi possível salvar.'); } finally { setEnviando(false); } }}
            usar={async t => { setEnviando(true); try { await usarTelefone(t); fechar(); } catch { setErro('Não foi possível trocar o número.'); } finally { setEnviando(false); } }}
            descartar={async t => { setEnviando(true); try { await descartarTelefone(t); fechar(); } catch { setErro('Não foi possível descartar o número.'); } finally { setEnviando(false); } }}/></>}
        <h3>Informações da fonte <Ajuda texto="Campo vazio significa que a fonte não informou esse dado. Não comprova que a empresa não tenha o recurso." /></h3>
        <DadosEmpresa empresa={e} ocupado={enviando} salvar={async dados => { setEnviando(true); try { await salvarDados(dados); fechar(); } finally { setEnviando(false); } }} />
        <dl className="dados-grid"><div><dt>Coletado em</dt><dd>{dataLocal(e.data_collected_at)}</dd></div><div><dt>Fonte original</dt><dd>{fonte ? <a href={fonte} target="_blank" rel="noreferrer">Consultar cadastro <ExternalLink size={13}/></a> : 'Não informada'}</dd></div></dl>
        <div className="acoes">{!e.opt_out_at && whatsapp && <a className="botao" href={whatsapp} target="_blank" rel="noreferrer"><Phone size={16}/> Abrir WhatsApp</a>}{!e.opt_out_at && ligar && <a className="botao secundario" href={ligar}>Ligar</a>}{!e.opt_out_at && !whatsapp && <><TestarWhatsapp telefone={e.main_phone} ocupado={enviando} confirmar={async tem => { setEnviando(true); try { await confirmarWhatsapp(tem); fechar(); } catch { setErro('Não foi possível salvar.'); } finally { setEnviando(false); } }}/><AcharWhatsapp nome={e.name} cidade={e.city}/></>}{e.opt_out_at && <p className="aviso">Empresa marcada como não contatar.</p>}</div>
        {!e.opt_out_at && !whatsapp && <p className="muted">As fontes não trouxeram celular. Teste se o fixo tem WhatsApp, ou ache o número e salve acima: a mensagem é refeita para o WhatsApp.</p>}
        {!e.opt_out_at && <button className="botao secundario" disabled={enviando} onClick={async () => { if (!confirm(`Marcar ${e.name} como não contatar?`)) return; setEnviando(true); try { await bloquear(); fechar(); } catch { setErro('Não foi possível registrar o bloqueio.'); } finally { setEnviando(false); } }}>Não contatar</button>}
        <h3>Fontes e evidências</h3>{carregando ? <p>Carregando…</p> : evidencias.length ? evidencias.map(v => <article className="registro" key={v.id}><strong>{v.title ?? 'Registro da pesquisa'}</strong><small>{dataLocal(v.observed_at)}</small><p>{v.extracted_text || 'Sem texto adicional.'}</p>{urlSegura(v.source_url) && <a href={urlSegura(v.source_url)!} target="_blank" rel="noreferrer">Abrir fonte <ExternalLink size={13}/></a>}</article>) : <p className="vazio">Nenhuma evidência adicional registrada.</p>}
      </>}
      {aba === 'proposta' && (brief ? <>
        <div className="titulo-linha"><h3>Sugestão comercial</h3><span className="muted">Confiança das regras: {Math.round(brief.confianca * 100)}% <Ajuda texto="Indicador calculado por regras a partir do cadastro disponível. Não é probabilidade de fechar contrato nem uma verificação independente." /></span></div>
        {brief.oferta_principal && <div className="oferta"><FileCheck2 size={26}/><div><h3>{brief.oferta_principal.titulo}</h3><p>{brief.oferta_principal.porque}</p><small>Estimativa sugerida: {brief.oferta_principal.faixa_preco ?? 'A definir'} · {brief.oferta_principal.prazo ?? 'Prazo a combinar'}</small></div></div>}
        <h3>Hipóteses a confirmar <Ajuda texto="As sugestões usam informações limitadas da pesquisa. Confirme a situação real com a empresa antes de apresentar uma proposta." /></h3>
        <ul className="hipoteses">{brief.diagnostico.map(d => <li key={d.codigo}><span className="marcador"/> <span>{d.texto}</span></li>)}</ul>
        <h3>Primeira mensagem <Ajuda texto="Você se apresenta e faz uma pergunta. Não oferece nada e não aponta problema: a oferta só entra se a pessoa responder." /></h3><blockquote>{brief.abertura}</blockquote><BotaoCopiar texto={brief.abertura} rotulo="Copiar mensagem" desativado={!!e.opt_out_at}/>
        <Continuacao brief={brief} contextoMaps={e.metadata?.observacoes?.observacao === 'nao_google'} bloqueada={!!e.opt_out_at} abrirPropostas={() => setAba('propostas')}/>
        {brief.roteiro_ligacao && !whatsapp && e.main_phone && <><h3>Roteiro de ligação <Ajuda texto="A fonte só trouxe telefone fixo. Ligue, ou procure o WhatsApp da empresa e salve o número em Dados encontrados." /></h3><pre className="texto-mensagem">{brief.roteiro_ligacao}</pre></>}
        {brief.respostas_prontas?.length ? <><h3>Respostas prontas</h3><div className="respostas">{brief.respostas_prontas.filter(r => !r.situacao.startsWith('Me manda mais informações')).map(r => <details key={r.situacao}><summary>{r.situacao}</summary><p>{r.resposta}</p><BotaoCopiar texto={r.resposta} rotulo="Copiar" desativado={!!e.opt_out_at}/></details>)}</div></> : null}
        <h3>Cuidados na abordagem</h3><ul>{brief.o_que_evitar.map(x => <li key={x}>{x}</li>)}</ul>
        {brief.alternativas.length > 0 && <><h3>Outras possibilidades</h3><ul>{brief.alternativas.map(x => <li key={x.codigo}>{x.titulo}</li>)}</ul></>}
      </> : <p className="vazio">Ainda não há uma análise disponível para esta empresa.</p>)}
      {aba === 'propostas' && <Propostas propostas={propostas} carregando={carregando} bloqueada={!!e.opt_out_at}
        sugestaoServico={brief?.oferta_principal?.titulo ?? ''}
        enviar={async corpo => { setErro(''); try { await proposta({ ...(corpo as object), company_id: e.id }); fechar(); } catch (err) { setErro(err instanceof Error ? err.message : 'Não foi possível salvar a proposta.'); } }}/>}
      {aba === 'andamento' && <>
        <form onSubmit={async event => { event.preventDefault(); setErro(''); setEnviando(true); try { await salvar({ company_id:e.id, updated_at:e.updated_at, status:etapa, nota, valor:valor === '' ? null : Number(valor), data, servico, retorno:retorno ? new Date(retorno).toISOString() : null, motivo: pedeMotivo ? motivo.trim() : null }); fechar(); } catch(err) { setErro(err instanceof Error ? err.message : 'Não foi possível salvar.'); } finally { setEnviando(false); } }}>
          <fieldset disabled={enviando || !!e.opt_out_at}>
            <label>Etapa atual<select value={etapa} onChange={event => setEtapa(event.target.value)}>{Object.entries(ETAPAS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <div className="form-grid"><label>Serviço contratado{etapa === 'won' && ' *'}<input maxLength={300} value={servico} required={etapa === 'won'} onChange={event => setServico(event.target.value)} placeholder="Ex.: site e agendamento"/></label><label>Valor do contrato (R$)<input type="number" min="0" max="999999999" step="0.01" value={valor} onChange={event => setValor(event.target.value)} placeholder="Não informado"/></label><label>Data do contrato{etapa === 'won' && ' *'}<input type="date" required={etapa === 'won'} value={data} onChange={event => setData(event.target.value)}/></label>{!['won','lost','rejected'].includes(etapa) && <label>Próximo retorno<input type="datetime-local" value={retorno} onChange={event => setRetorno(event.target.value)}/></label>}</div>
            {pedeMotivo && <label>{etapa === 'won' ? 'Por que fechou?' : 'Por que não fechou?'} *<input list={`motivos-${etapa}`} required maxLength={200} value={motivo} onChange={event => setMotivo(event.target.value)} placeholder="Escolha uma sugestão ou escreva"/><datalist id={`motivos-${etapa}`}>{MOTIVOS[etapa as 'won' | 'lost'].map(x => <option key={x} value={x}/>)}</datalist></label>}
            {pedeMotivo && <div className="sugestoes" aria-label="Sugestões de motivo">{MOTIVOS[etapa as 'won' | 'lost'].map(x => <button type="button" key={x} className={motivo === x ? 'ativa' : ''} onClick={() => setMotivo(x)}>{x}</button>)}</div>}
            <label>O que aconteceu?<textarea rows={3} maxLength={5000} value={nota} onChange={event => setNota(event.target.value)} placeholder="Conversa, condições combinadas ou próximo passo…"/></label>
            <button className="botao" type="submit">{enviando ? <LoaderCircle size={16} className="girando"/> : <Save size={16}/>} {enviando ? 'Salvando e sincronizando…' : 'Salvar acompanhamento'}</button>
          </fieldset>
        </form>
        <h3>Histórico da empresa</h3>{carregando ? <p>Carregando…</p> : historico.length ? historico.map(h => <article className="registro" key={h.id}><small>{new Date(h.happened_at).toLocaleString('pt-BR')}</small><strong>{h.title}</strong>{h.metadata?.para && <p>{ETAPAS[h.metadata.de ?? ''] ?? h.metadata.de} → {ETAPAS[h.metadata.para] ?? h.metadata.para}</p>}{h.body && <p>{h.body}</p>}</article>) : <p className="vazio">Nenhuma interação registrada ainda.</p>}
      </>}
    </div>
  </dialog>;
}
