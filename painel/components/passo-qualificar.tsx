"use client";

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, LoaderCircle, Phone, RefreshCw, Search } from 'lucide-react';
import type { Canal, DadosPainel, EmpresaComCanal } from '@/lib/tipos';
import { criterios, fontesDe, prioridade } from '@/lib/qualificar';
import { AcharWhatsapp, Ajuda, ListaTelefones } from '@/components/ui';
import { telefonesDe } from '@/lib/telefones';

/**
 * Passo 2 · Qualificar. Empresas ainda não contatadas, com o canal indicado
 * (WhatsApp, ligação, e-mail) e a prioridade com o porquê à vista.
 * Cada empresa junta o que veio do CNPJ e do mapa ("dados: CNPJ + mapa").
 */
export const ROTULO_CANAL: Record<Canal, string> = {
  whatsapp: 'WhatsApp', phone: 'Ligação', email: 'E-mail', sem_contato: 'Sem contato',
};
const CLASSE_CANAL: Record<Canal, string> = { whatsapp: 'zap', phone: 'lig', email: 'mail', sem_contato: 'sem' };

export function SeloCanal({ canal }: { canal: Canal }) {
  return <span className={`canal ${CLASSE_CANAL[canal]}`}>{ROTULO_CANAL[canal]}</span>;
}

function Cartao({ e, temRascunho, ocupado, abrir, preparar, confirmarWhatsapp, usarTelefone, descartarTelefone }: {
  e: EmpresaComCanal; temRascunho: string | null; ocupado: boolean;
  abrir: () => void; preparar: (messageId: string) => void;
  confirmarWhatsapp: (tem: boolean, telefone: string) => void; usarTelefone: (telefone: string) => void;
  descartarTelefone: (telefone: string) => void;
}) {
  const telefones = telefonesDe(e);
  const lista = criterios(e);
  const p = prioridade(e);
  const ano = e.metadata?.inicio_atividade?.slice(0, 4);
  const lugar = [e.metadata?.bairro, e.city].filter(Boolean).join(' · ');
  return <article className="cartao empresa">
    <div className={`nota-op ${p.classe}`} aria-label={`Prioridade ${p.rotulo.toLowerCase()}`}>{p.rotulo}<small>prioridade</small></div>
    <div className="empresa-info">
      <h3>{e.name} <SeloCanal canal={e.canal}/></h3>
      <div className="meta">{e.advisor_brief?.segmento ?? e.category ?? 'Segmento a confirmar'}{lugar && ` · ${lugar}`}{ano && ` · CNPJ desde ${ano}`} · <b>dados: {fontesDe(e)}</b></div>
      <p className="motivo-op">{p.motivo}</p>
      <div className="sinais">{lista.map(c => <span key={c.chave} title={c.ajuda} className={`sinal ${c.estado === 'sim' ? 'ok' : ''}`}>
        {c.estado === 'sim' ? '✓' : c.estado === 'nao' ? '–' : '?'} {c.rotulo}</span>)}</div>
    </div>
    {(telefones.length > 0 || e.metadata?.possivel_duplicata) && <div className="empresa-extra">
      <ListaTelefones telefones={telefones} ocupado={ocupado} compacta confirmar={(t, tem) => confirmarWhatsapp(tem, t)} usar={usarTelefone} descartar={descartarTelefone}/>
      {e.metadata?.possivel_duplicata && <p className="aviso pequeno"><AlertTriangle size={14}/> Nome muito parecido com outra empresa da mesma cidade. Abra a ficha e confira se é a mesma antes de contatar.</p>}
    </div>}
    <div className="acoes-emp">
      <button type="button" className="btn btn-s" onClick={abrir}>Ver ficha</button>
      {(e.canal === 'phone' || e.canal === 'sem_contato') && <AcharWhatsapp nome={e.name} cidade={e.city}/>}
      {temRascunho
        ? <button type="button" className="btn btn-p" onClick={() => preparar(temRascunho)}>{e.canal === 'phone' ? <><Phone size={16}/> Roteiro de ligação</> : <>Preparar mensagem <ArrowRight size={16}/></>}</button>
        : e.canal !== 'sem_contato' && <span className="muted pequeno">Mensagem sendo escrita…</span>}
    </div>
  </article>;
}

export default function PassoQualificar({ dados: d, ocupado, filtrar, abrir, preparar, confirmarWhatsapp, usarTelefone, descartarTelefone, processarFila }: {
  dados: DadosPainel; ocupado: boolean;
  filtrar: (f: { canal?: string; q?: string; pagina?: number }) => void;
  abrir: (id: string) => void;
  preparar: (messageId: string, canal: string) => void;
  confirmarWhatsapp: (companyId: string, tem: boolean, telefone?: string) => void;
  usarTelefone: (companyId: string, telefone: string) => void;
  descartarTelefone: (companyId: string, telefone: string) => void;
  processarFila: () => void;
}) {
  const [q, setQ] = useState(d.filtro.busca);
  useEffect(() => setQ(d.filtro.busca), [d.filtro.busca]);
  const rascunhoDe = new Map(d.mensagens.map(m => [m.company_id, m.id]));
  const total = Object.values(d.funil.canais).reduce((a, b) => a + (b ?? 0), 0);
  const paginas = Math.max(1, Math.ceil(d.totalFiltrado / 30));
  const filtros: Array<[string, string, number]> = [
    ['', 'Todas', total],
    ['whatsapp', 'WhatsApp', d.funil.canais.whatsapp ?? 0],
    ['phone', 'Ligação', d.funil.canais.phone ?? 0],
    ['email', 'E-mail', d.funil.canais.email ?? 0],
    ['sem_contato', 'Sem contato', d.funil.canais.sem_contato ?? 0],
  ];

  return <section aria-labelledby="titulo-qualificar">
    <div className="cabeca"><div><h1 id="titulo-qualificar">Qualificar</h1><p>Quem ainda não foi contatado, com o canal e o motivo da prioridade à vista.</p></div></div>
    <div className="filtros">
      <div className="chips" role="radiogroup" aria-label="Canal">
        {filtros.filter(([v, , n]) => v === '' || n > 0 || d.filtro.canal === v).map(([v, rotulo, n]) =>
          <button key={v || 'todas'} type="button" role="radio" aria-checked={d.filtro.canal === v} className="chip" aria-pressed={d.filtro.canal === v}
            disabled={ocupado} onClick={() => filtrar({ canal: v, q: d.filtro.busca, pagina: 1 })}>{rotulo} · {n}</button>)}
      </div>
      <form className="busca" onSubmit={e => { e.preventDefault(); filtrar({ canal: d.filtro.canal, q, pagina: 1 }); }}>
        <Search size={17}/><input aria-label="Buscar pelo nome" placeholder="Buscar pelo nome…" value={q} onChange={e => setQ(e.target.value)}/>
      </form>
    </div>

    {(d.resumo.tarefasPendentes > 0 || d.resumo.tarefasComFalha > 0) && <div className="faixa">
      <span><strong>{d.resumo.tarefasPendentes}</strong> {d.resumo.tarefasPendentes === 1 ? 'empresa sendo analisada' : 'empresas sendo analisadas'} <Ajuda texto="Depois da busca, cada empresa passa pelas regras e ganha a mensagem do canal certo. Normalmente leva segundos."/></span>
      {d.resumo.tarefasComFalha > 0 && <span className="erro-texto">{d.resumo.tarefasComFalha} com falha</span>}
      <button type="button" className="btn btn-s" disabled={ocupado || !d.resumo.tarefasPendentes} onClick={processarFila}>
        {ocupado ? <LoaderCircle size={15} className="girando"/> : <RefreshCw size={15}/>} Processar agora</button>
    </div>}

    <div className="lista" aria-busy={ocupado}>
      {d.empresas.map(e => <Cartao key={e.id} e={e} ocupado={ocupado} temRascunho={rascunhoDe.get(e.id) ?? null}
        abrir={() => abrir(e.id)} preparar={id => preparar(id, e.canal)} confirmarWhatsapp={(tem, t) => confirmarWhatsapp(e.id, tem, t)} usarTelefone={t => usarTelefone(e.id, t)} descartarTelefone={t => descartarTelefone(e.id, t)}/>)}
      {!d.empresas.length && <p className="vazio">{d.filtro.busca || d.filtro.canal ? 'Nenhuma empresa com esse filtro.' : 'Nenhuma empresa esperando contato. Vá em 1 · Encontrar e traga novas.'}</p>}
    </div>
    {paginas > 1 && <div className="paginacao"><span>Página {d.filtro.pagina} de {paginas}</span><div>
      <button className="icone" aria-label="Página anterior" disabled={ocupado || d.filtro.pagina <= 1} onClick={() => filtrar({ ...d.filtro, q: d.filtro.busca, pagina: d.filtro.pagina - 1 })}><ChevronLeft/></button>
      <button className="icone" aria-label="Próxima página" disabled={ocupado || d.filtro.pagina >= paginas} onClick={() => filtrar({ ...d.filtro, q: d.filtro.busca, pagina: d.filtro.pagina + 1 })}><ChevronRight/></button>
    </div></div>}
  </section>;
}
