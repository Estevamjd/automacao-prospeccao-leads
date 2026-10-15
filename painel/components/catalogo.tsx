"use client";

import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import type { NichoDetalhe } from '@/lib/tipos';

const lista = (texto: string) => [...new Set(texto.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean))];
const linhas = (itens: string[] | null | undefined) => (itens ?? []).join('\n');
const vazio = (): NichoDetalhe => ({ id: '', slug: '', label: '', icone: null, ordem: 100,
  is_active: false, apresentacao: '', cnaes_principais: [], cnaes_com_palavra: [], cnaes_secundarios: [],
  google_types: [], osm_tags: [], palavras_nome: [], palavras_excluir: [], opening_questions: [], avoid: [], pains: [], offers: [] });

export default function Catalogo({ nichos, aoSalvar }: { nichos: NichoDetalhe[]; aoSalvar: () => void }) {
  const [itens, setItens] = useState(nichos);
  const [atual, setAtual] = useState<NichoDetalhe>(nichos[0] ?? vazio());
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const editar = <K extends keyof NichoDetalhe>(campo: K, valor: NichoDetalhe[K]) => setAtual(a => ({ ...a, [campo]: valor }));
  const campoLista = (campo: 'cnaes_principais' | 'cnaes_com_palavra' | 'cnaes_secundarios' | 'google_types' | 'palavras_nome' | 'palavras_excluir' | 'opening_questions' | 'avoid', rotulo: string) =>
    <label className="campo" key={`${atual.id}-${campo}`}>{rotulo}<textarea rows={3} defaultValue={linhas(atual[campo])} onBlur={e => editar(campo, lista(e.target.value))}/></label>;

  async function salvar() {
    setOcupado(true); setErro(''); setAviso('');
    try {
      const r = await fetch('/api/actions/catalogo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(atual) });
      const resultado = await r.json();
      if (!r.ok) throw new Error(resultado.error ?? 'Não foi possível salvar.');
      const salvo = resultado.nicho as NichoDetalhe;
      setAtual(salvo);
      setItens(anteriores => [...anteriores.filter(n => n.id !== salvo.id), salvo].sort((a, b) => a.ordem - b.ordem));
      setAviso('Nicho salvo. Os cadastros já carregados não mudam até serem reclassificados.');
      aoSalvar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setOcupado(false); }
  }

  return <section className="catalogo-editor" aria-labelledby="titulo-catalogo">
    <div className="cabeca"><div><h1 id="titulo-catalogo">Catálogo de nichos</h1><p>Segmentos, fontes e oferta inicial.</p></div>
      <button type="button" className="btn btn-s" onClick={() => { setAtual(vazio()); setErro(''); setAviso(''); }}><Plus size={16}/> Novo nicho</button></div>
    <div className="grade catalogo-grade">
      <div className="cartao"><h3>Nichos</h3>{itens.map(n => <button type="button" className="linha-lista clicavel" key={n.id}
        aria-current={atual.id === n.id ? 'true' : undefined} onClick={() => { setAtual(n); setErro(''); setAviso(''); }}>
        <span>{n.label}</span><small className="muted">{n.is_active ? 'Ativo' : 'Inativo'}</small>
      </button>)}</div>
      <div className="cartao campos">
        <h3>{atual.id ? atual.label : 'Novo nicho'}</h3>
        <div className="linha-campos">
          <label className="campo">Identificador<input value={atual.slug} disabled={!!atual.id} maxLength={40}
            onChange={e => editar('slug', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}/></label>
          <label className="campo">Nome no painel<input value={atual.label} maxLength={80} onChange={e => editar('label', e.target.value)}/></label>
        </div>
        <label className="campo">Apresentação da oferta<input value={atual.apresentacao ?? ''} maxLength={200} onChange={e => editar('apresentacao', e.target.value)}/></label>
        <div className="linha-campos">
          {campoLista('cnaes_principais', 'CNAEs principais (7 dígitos)')}
          {campoLista('cnaes_com_palavra', 'CNAEs que exigem palavra no nome')}
          {campoLista('cnaes_secundarios', 'CNAEs secundários')}
        </div>
        <div className="linha-campos">
          {campoLista('palavras_nome', 'Palavras para reconhecer')}
          {campoLista('palavras_excluir', 'Palavras para excluir')}
          {campoLista('google_types', 'Tipos Google (sem API ligada)')}
        </div>
        <label className="campo">Tags do OpenStreetMap (uma por linha: chave=valor1,valor2)
          <textarea key={atual.id} rows={4} defaultValue={atual.osm_tags.map(t => `${t.chave}=${t.valores.join(',')}`).join('\n')}
            onBlur={e => editar('osm_tags', e.target.value.split('\n').map(l => {
              const [chave, valores = ''] = l.split('='); return { chave: chave.trim(), valores: lista(valores) };
            }).filter(t => t.chave))}/>
        </label>
        <div className="linha-campos">
          {campoLista('opening_questions', 'Perguntas para abrir conversa')}
          {campoLista('avoid', 'O que evitar')}
        </div>
        <h3>Ofertas</h3>
        {atual.offers.map((o, i) => <div className="oferta-editor" key={i}>
          <div className="linha-campos"><label className="campo">Código<input value={o.codigo} maxLength={50} onChange={e => editar('offers', atual.offers.map((x, j) => j === i ? { ...x, codigo: e.target.value } : x))}/></label>
            <label className="campo">Título<input value={o.titulo} maxLength={120} onChange={e => editar('offers', atual.offers.map((x, j) => j === i ? { ...x, titulo: e.target.value } : x))}/></label></div>
          <label className="campo">Benefício<input value={o.porque} maxLength={300} onChange={e => editar('offers', atual.offers.map((x, j) => j === i ? { ...x, porque: e.target.value } : x))}/></label>
          <label className="campo">Como explicar<input value={o.pitch} maxLength={300} onChange={e => editar('offers', atual.offers.map((x, j) => j === i ? { ...x, pitch: e.target.value } : x))}/></label>
          <div className="linha-campos"><label className="campo">Faixa de preço<input value={o.faixa_preco ?? ''} maxLength={80} onChange={e => editar('offers', atual.offers.map((x, j) => j === i ? { ...x, faixa_preco: e.target.value } : x))}/></label>
            <label className="campo">Esforço<select value={o.esforco} onChange={e => editar('offers', atual.offers.map((x, j) => j === i ? { ...x, esforco: e.target.value } : x))}>{['baixo','medio','alto'].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
            <label className="campo">Impacto<select value={o.impacto} onChange={e => editar('offers', atual.offers.map((x, j) => j === i ? { ...x, impacto: e.target.value } : x))}>{['baixo','medio','alto'].map(v => <option key={v} value={v}>{v}</option>)}</select></label></div>
        </div>)}
        <button type="button" className="btn btn-s" onClick={() => editar('offers', [...atual.offers, { codigo: '', titulo: '', porque: '', pitch: '', esforco: 'baixo', impacto: 'medio' }])}><Plus size={16}/> Adicionar oferta</button>
        <label className="checkbox-linha"><input type="checkbox" checked={atual.is_active} onChange={e => editar('is_active', e.target.checked)}/> Nicho ativo na busca</label>
        <p className="muted">CNAEs novos só entram na reserva após uma nova extração da Receita. As regras atuais não são alteradas aqui.</p>
        {erro && <p role="alert" className="aviso erro">{erro}</p>}{aviso && <p role="status" className="aviso sucesso">{aviso}</p>}
        <button type="button" className="btn btn-p" disabled={ocupado} onClick={() => void salvar()}><Save size={16}/>{ocupado ? 'Salvando…' : 'Salvar nicho'}</button>
      </div>
    </div>
  </section>;
}
