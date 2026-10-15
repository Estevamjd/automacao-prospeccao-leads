"use client";

import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Croissant, Dumbbell, Flower2, GraduationCap, Hand, IceCreamCone, LoaderCircle, MapPin, PawPrint, Pizza, Scissors, Search, ShoppingBasket, Sparkles, Stethoscope, UtensilsCrossed, Wrench } from 'lucide-react';
import { criarClienteNavegador } from '@/lib/supabase/client';
import { CAPITAIS, UFS, zonasDe } from '@/lib/geografia';
import type { BuscaSalva, DadosPainel } from '@/lib/tipos';
import { Ajuda } from '@/components/ui';

/**
 * Passo 1 · Encontrar. Uma busca só: cadastro de CNPJ + mapa, juntando o que
 * cada fonte sabe da mesma empresa. Não há escolha de fonte (decisão do
 * Estevam em 29/09). Depois de trazer, a fila escreve as mensagens sozinha.
 */
type Resultado = { mensagem: string; novas: number; completadas: number };

const META_DIA = 15;
const numero = (n: number) => n.toLocaleString('pt-BR');
const LEGADOS = new Set(['academia', 'bar', 'educacao', 'mercado', 'odonto']);
const ICONES = { restaurante: UtensilsCrossed, pizzaria: Pizza, sorveteria: IceCreamCone, padaria: Croissant,
  barbearia: Scissors, manicure: Hand, beleza: Flower2, estetica: Sparkles, academia: Dumbbell,
  clinica: Stethoscope, petshop: PawPrint, oficina: Wrench, mercado: ShoppingBasket,
  educacao: GraduationCap };

export default function PassoEncontrar({ dados: d, ocupado, buscar, irPara }: {
  dados: DadosPainel;
  ocupado: boolean;
  buscar: (corpo: unknown, progresso: (texto: string) => void) => Promise<Resultado | null>;
  irPara: (passo: 'qualificar' | 'contatar') => void;
}) {
  const ufsDisponiveis = useMemo(() => [...new Set([...Object.keys(UFS), ...d.geografia.map(g => g.uf)])].sort(), [d.geografia]);
  const [uf, setUf] = useState('RJ');
  const [municipio, setMunicipio] = useState(CAPITAIS.RJ.municipio);
  const [outraCidade, setOutraCidade] = useState('');
  const [zona, setZona] = useState('norte');
  const [bairros, setBairros] = useState<string[]>(['Olaria']);
  const [todosBairros, setTodosBairros] = useState(false);
  const [nicho, setNicho] = useState('restaurante');
  const [cep, setCep] = useState('');
  const [quantidade, setQuantidade] = useState(20);
  const [listaBairros, setListaBairros] = useState<Array<{ bairro: string; disponiveis: number }>>([]);
  const [porNicho, setPorNicho] = useState<Record<string, { disponiveis: number; com_celular: number }>>({});
  const [salvas, setSalvas] = useState<BuscaSalva[]>(d.buscasSalvas);
  const [nomeBusca, setNomeBusca] = useState('');
  const [erroLocal, setErroLocal] = useState('');
  const [progresso, setProgresso] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // Cidades com empresas no cadastro, as maiores primeiro. A capital sempre aparece.
  const cidades = useMemo(() => {
    const soma = new Map<string, number>();
    for (const g of d.geografia.filter(g => g.uf === uf)) soma.set(g.municipio, (soma.get(g.municipio) ?? 0) + g.disponiveis);
    if (CAPITAIS[uf] && !soma.has(CAPITAIS[uf].municipio)) soma.set(CAPITAIS[uf].municipio, 0);
    return [...soma.entries()].sort((a, b) => b[1] - a[1]);
  }, [d.geografia, uf]);

  const cidade = municipio === '__outra' ? outraCidade.trim() : municipio;
  const zonas = zonasDe(uf, cidade);
  const zonaValida = zonas && zona in zonas ? zona : '';
  const noCadastro = d.geografia.some(g => g.uf === uf);

  // Bairros e contagem por nicho vêm do banco conforme o filtro (RLS do usuário).
  useEffect(() => {
    if (!d.workspaceId) return;
    let ativo = true;
    const sb = criarClienteNavegador();
    const promessas = [
      cidade && municipio !== '__outra'
        ? sb.rpc('bairros_reserva_v3', { p_workspace: d.workspaceId, p_uf: uf, p_municipio: cidade, p_zona: zonaValida || null, p_nichos: [nicho] })
        : Promise.resolve({ data: [] }),
      sb.rpc('resumo_reserva_nicho', {
        p_workspace: d.workspaceId, p_uf: uf, p_municipio: cidade || null, p_zona: zonaValida || null,
        p_bairros: bairros.length ? bairros : null, p_cep: cep || null,
      }),
      sb.rpc('resumo_reserva_cnpj', {
        p_workspace: d.workspaceId, p_uf: uf, p_municipio: cidade || null, p_zona: zonaValida || null,
        p_bairros: bairros.length ? bairros : null,
      }),
    ] as const;
    Promise.all(promessas).then(([b, r, antigo]) => {
      if (!ativo) return;
      setListaBairros(((b.data ?? []) as Array<{ bairro: string; disponiveis: number }>));
      const mapa: Record<string, { disponiveis: number; com_celular: number }> = {};
      for (const x of (r.data ?? []) as Array<{ nicho: string; disponiveis: number; com_celular: number }>) mapa[x.nicho] = x;
      for (const x of (antigo.data ?? []) as Array<{ segmento: string; disponiveis: number; com_celular: number }>) {
        if (LEGADOS.has(x.segmento)) mapa[x.segmento] = x;
      }
      setPorNicho(mapa);
      if (r.error || antigo.error) setErroLocal('Não foi possível consultar as quantidades do cadastro.');
    });
    return () => { ativo = false; };
  }, [d.workspaceId, uf, cidade, municipio, zonaValida, bairros, cep, nicho]);

  const atual = porNicho[nicho] ?? { disponiveis: 0, com_celular: 0 };
  const bairrosVisiveis = todosBairros ? listaBairros : listaBairros.slice(0, 18);
  const aQualificar = Object.values(d.funil.canais).reduce((a, b) => a + (b ?? 0), 0);
  const prontas = Object.values(d.funil.rascunhos).reduce((a, b) => a + b, 0);

  function trocarUf(novo: string) {
    setUf(novo); setBairros([]); setZona('');
    setMunicipio(CAPITAIS[novo]?.municipio ?? '');
  }

  function carregarSalva(b: BuscaSalva) {
    const f = b.filtros;
    if (typeof f.uf !== 'string' || typeof f.nicho !== 'string') return;
    setUf(f.uf); setMunicipio(typeof f.municipio === 'string' ? f.municipio : '');
    setZona(typeof f.zona === 'string' ? f.zona : '');
    setBairros(Array.isArray(f.bairros) ? f.bairros.filter((x): x is string => typeof x === 'string').slice(0, 30) : []);
    setNicho(f.nicho); setCep(LEGADOS.has(f.nicho) ? '' : typeof f.cep === 'string' ? f.cep : '');
    setQuantidade(typeof f.quantidade === 'number' ? f.quantidade : 20);
    setResultado(null); setErroLocal('');
  }

  async function salvarBusca() {
    const nome = nomeBusca.trim();
    if (!d.workspaceId || nome.length < 2 || nome.length > 80) { setErroLocal('Dê um nome de 2 a 80 caracteres à busca.'); return; }
    const filtros = { uf, municipio: cidade || null, zona: zonaValida || null, bairros, nicho, cep, quantidade };
    const { data, error } = await criarClienteNavegador().from('buscas_salvas')
      .insert({ workspace_id: d.workspaceId, nome, filtros }).select('id,nome,filtros').single();
    if (error || !data) { setErroLocal(error?.message ?? 'Não foi possível salvar a busca.'); return; }
    setSalvas([data as BuscaSalva, ...salvas].slice(0, 20)); setNomeBusca(''); setErroLocal('');
  }

  return <section aria-labelledby="titulo-encontrar">
    <div className="cabeca"><div><h1 id="titulo-encontrar">Encontrar empresas</h1><p>Escolha onde e o quê. Traga só o que dá para contatar nos próximos dias.</p></div></div>
    <div className="grade g-2">
      <form className="cartao" onSubmit={async ev => {
        ev.preventDefault(); setResultado(null); setErroLocal('');
        const r = await buscar({ uf, municipio: cidade || null, zona: zonaValida || null, bairros, nicho, cep, quantidade }, setProgresso);
        setProgresso(''); if (r) setResultado(r);
      }}>
        <div className="dica marca"><Sparkles size={16}/><span>Busca no cadastro de CNPJ e no mapa. O cadastro prioriza empresas com celular; o mapa pode complementar os dados.</span></div>
        {!noCadastro && <p className="aviso">O cadastro de CNPJ deste estado ainda não foi carregado. A busca vai só no mapa, que traz poucas empresas com contato.</p>}
        <fieldset disabled={ocupado} className="campos">
          <div className="linha-campos">
            <label className="campo">Estado
              <select value={uf} onChange={e => trocarUf(e.target.value)}>{ufsDisponiveis.map(u => <option key={u} value={u}>{UFS[u] ?? u}</option>)}</select>
            </label>
            <label className="campo">Cidade
              <select value={municipio} onChange={e => { setMunicipio(e.target.value); setBairros([]); setZona(''); }}>
                <option value="">Estado inteiro</option>
                {cidades.map(([m, n]) => <option key={m} value={m}>{m}{n ? ` · ${numero(n)}` : ''}</option>)}
                <option value="__outra">Outra cidade…</option>
              </select>
            </label>
            {zonas
              ? <label className="campo">Zona
                  <select value={zonaValida} onChange={e => { setZona(e.target.value); setBairros([]); }}>
                    <option value="">Cidade inteira</option>
                    {Object.entries(zonas).map(([z, rotulo]) => <option key={z} value={z}>{rotulo}</option>)}
                  </select>
                </label>
              : <label className="campo">Quantas
                  <select value={quantidade} onChange={e => setQuantidade(Number(e.target.value))}>{[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}</select>
                </label>}
          </div>
          {municipio === '__outra' && <label className="campo">Nome da cidade<input value={outraCidade} maxLength={80} onChange={e => setOutraCidade(e.target.value)} placeholder="Ex.: Petrópolis"/></label>}

          <label className="campo">CEP (opcional)
            <input inputMode="numeric" value={cep} maxLength={8} disabled={LEGADOS.has(nicho)} onChange={e => setCep(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder={LEGADOS.has(nicho) ? 'Use cidade e bairro neste nicho' : 'Ex.: 21021000'}/>
          </label>
          {cep && <p className="muted">O filtro por CEP vale apenas para o cadastro CNPJ; o mapa não traz CEP confiável para todos os locais.</p>}

          {listaBairros.length > 0 && <>
            <p className="rotulo">Bairros <span className="muted">(opcional; sem nenhum, vale a {zonaValida ? 'zona' : 'cidade'} inteira)</span></p>
            <div className="chips">
              {bairrosVisiveis.map(b => <button type="button" key={b.bairro} className="chip" aria-pressed={bairros.includes(b.bairro)}
                onClick={() => setBairros(bairros.includes(b.bairro) ? bairros.filter(x => x !== b.bairro) : [...bairros, b.bairro].slice(0, 30))}>
                {b.bairro} <small>{numero(b.disponiveis)}</small></button>)}
              {listaBairros.length > 18 && <button type="button" className="chip" onClick={() => setTodosBairros(!todosBairros)}>{todosBairros ? 'Menos' : `+ ${listaBairros.length - 18}`}</button>}
            </div>
          </>}

          <p className="rotulo">Nicho</p>
          <div className="chips nichos" role="radiogroup" aria-label="Nicho">
            {d.nichos.map(n => {
              const Icone = ICONES[n.slug as keyof typeof ICONES] ?? Search;
              return <button type="button" role="radio" aria-checked={nicho === n.slug} key={n.slug} className="chip" aria-pressed={nicho === n.slug} onClick={() => { setNicho(n.slug); if (LEGADOS.has(n.slug)) setCep(''); }}>
                <Icone size={15} aria-hidden="true"/> {n.label}{porNicho[n.slug] ? <small> {numero(porNicho[n.slug].disponiveis)}</small> : null}</button>;
            })}
          </div>

          <div className="disponivel">
            <div className="num"><b>{numero(atual.disponiveis)}</b><span>no cadastro, ainda não trazidas</span></div>
            <div className="num"><b>{numero(atual.com_celular)}</b><span>com celular (vêm primeiro)</span></div>
            <div className="num"><b><MapPin size={18}/></b><span>{cep ? 'CEP: só cadastro CNPJ' : '+ o mapa, consultado na hora'}</span></div>
          </div>

          <div className="linha-acao">
            {zonas && <label className="campo quantas">Quantas
              <select value={quantidade} onChange={e => setQuantidade(Number(e.target.value))}>{[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}</select>
            </label>}
            <button className="btn btn-p btn-grande" disabled={ocupado || !d.nichos.length || (municipio === '__outra' && !outraCidade.trim())}>
              {ocupado ? <LoaderCircle size={18} className="girando"/> : <Search size={18}/>}
              {ocupado ? (progresso || 'Buscando…') : `Trazer ${quantidade} para a base`}
            </button>
          </div>
          <p className="muted">A busca no mapa pode levar alguns minutos em áreas grandes. Nada é enviado: as mensagens ficam prontas para você revisar.</p>
        </fieldset>
        {erroLocal && <p role="alert" className="aviso erro">{erroLocal}</p>}
        {resultado && <div className="resultado" role="status">
          <p>{resultado.mensagem}</p>
          <div className="acoes">
            <button type="button" className="btn btn-p" onClick={() => irPara('qualificar')}>Ver as empresas</button>
            <button type="button" className="btn btn-s" onClick={() => irPara('contatar')}>Ir para mensagens</button>
          </div>
        </div>}
      </form>

      <div className="grade coluna">
        <div className="cartao">
          <h3>Buscas salvas</h3>
          <div className="linha-acao"><input aria-label="Nome da busca" placeholder="Ex.: Restaurantes de Olaria" value={nomeBusca} maxLength={80} onChange={e => setNomeBusca(e.target.value)}/>
            <button type="button" className="btn btn-s" disabled={ocupado || !nomeBusca.trim()} onClick={() => void salvarBusca()}><Bookmark size={16}/> Salvar</button></div>
          {salvas.map(b => <button type="button" className="linha-lista clicavel" key={b.id} onClick={() => carregarSalva(b)}>{b.nome}</button>)}
          {!salvas.length && <p className="vazio">Nenhuma busca salva.</p>}
        </div>
        <div className="cartao">
          <h3>Sua semana <Ajuda texto={`Mais de ${META_DIA} conversas novas por dia no WhatsApp aumenta o risco de o número ser bloqueado.`}/></h3>
          <p className="muted">Meta: até {META_DIA} conversas novas por dia no WhatsApp.</p>
          <div className="disponivel">
            <button type="button" className="num" onClick={() => irPara('qualificar')}><b>{numero(aQualificar)}</b><span>a qualificar</span></button>
            <button type="button" className="num" onClick={() => irPara('contatar')}><b>{numero(prontas)}</b><span>mensagens prontas</span></button>
            <div className={`num ${d.funil.enviadas_hoje >= META_DIA ? 'alerta' : ''}`}><b>{numero(d.funil.enviadas_hoje)}</b><span>enviadas hoje</span></div>
          </div>
        </div>
        <div className="cartao">
          <h3>Últimas buscas</h3>
          {d.funil.buscas.length ? d.funil.buscas.map(b => <div className="linha-lista" key={`${b.nome}-${b.criada_em}`}>
            <span>{b.nome.replace(/^Mapa \(OpenStreetMap\) · /, 'Mapa · ')}</span>
            <span className="muted">{b.trazidas} {b.trazidas === 1 ? 'nova' : 'novas'} · {new Date(b.criada_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
          </div>) : <p className="vazio">Nenhuma busca ainda.</p>}
        </div>
      </div>
    </div>
  </section>;
}
