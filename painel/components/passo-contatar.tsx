"use client";

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Ban, Camera, ExternalLink, Mail, MessageCircle, Phone, Search, SkipForward } from 'lucide-react';
import type { DadosPainel, Mensagem, ScriptTemplate } from '@/lib/tipos';
import { buscasEmpresa, linkLigar, urlSegura, whatsappDoNumero } from '@/lib/comercial';
import { bloqueioDoEstilo, ESTILOS, montarMensagem, observacoesDo, ONDE_VIU, separarRodape, type OQueViu } from '@/lib/mensagem';
import { AcharWhatsapp, BotaoCopiar, ListaTelefones } from '@/components/ui';
import { podeWhatsapp, telefonesDe } from '@/lib/telefones';
import { SeloCanal } from '@/components/passo-qualificar';
import Continuacao from '@/components/continuacao';

/**
 * Passo 3 · Contatar, em modo sequência: uma empresa por vez.
 * Olhar (30 s no Google/Instagram) → marcar o que viu → mensagem se ajusta →
 * abrir no WhatsApp → marcar enviada → próxima.
 * A primeira mensagem nunca leva link nem oferta; a segunda (se responder)
 * e as respostas prontas ficam ao lado.
 */
const META_DIA = 15;
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const VIU_VAZIO: OQueViu = { onde: '', nota: '', observacao: '', outra: '' };

type Acoes = {
  salvar: (m: Mensagem, corpo: string, viu: OQueViu | null) => Promise<void>;
  usarScript: (m: Mensagem, templateId: string) => Promise<void>;
  enviada: (m: Mensagem) => Promise<void>;
  naoContatar: (m: Mensagem) => Promise<void>;
  confirmarWhatsapp: (companyId: string, tem: boolean, telefone?: string) => void;
  usarTelefone: (companyId: string, telefone: string) => void;
  descartarTelefone: (companyId: string, telefone: string) => void;
  abrir: (companyId: string) => void;
};

function Sequencia({ m, scripts, posicao, total, enviadasHoje, ocupado, acoes, pular }: {
  m: Mensagem; scripts: ScriptTemplate[]; posicao: number; total: number; enviadasHoje: number; ocupado: boolean; acoes: Acoes; pular: () => void;
}) {
  const e = m.empresa;
  const brief = e?.advisor_brief ?? null;
  const partes = brief?.partes;
  const segmento = brief?.playbook_slug ?? null;
  const { texto: original, rodape } = useMemo(() => separarRodape(m.body), [m.body]);
  const [viu, setViu] = useState<OQueViu>(VIU_VAZIO);
  const [texto, setTexto] = useState(original);
  const [editadoAMao, setEditadoAMao] = useState(false);
  const [destino, setDestino] = useState('');
  const [erro, setErro] = useState('');
  const [scriptId, setScriptId] = useState(m.template_id ?? '');
  const [escolhaScript, setEscolhaScript] = useState('');
  const [bairroScript, setBairroScript] = useState(e?.metadata?.bairro ?? '');
  const [notaScript, setNotaScript] = useState('');
  const [avaliacoesScript, setAvaliacoesScript] = useState('');
  const [conferiuPesquisa, setConferiuPesquisa] = useState(false);
  const scriptsPrimeiroContato = scripts.filter(s => s.channel === m.channel && s.nicho === segmento && s.etapa === 'primeiro_contato');
  const escolhido = scriptsPrimeiroContato.find(s => s.id === escolhaScript);

  // Trocar de empresa zera o formulário.
  useEffect(() => { setViu(VIU_VAZIO); setTexto(original); setEditadoAMao(false); setErro(''); }, [m.id, original]);

  // O que você viu (e o jeito de abrir) reescreve a mensagem, a menos que
  // você já tenha editado à mão. Estilo que ainda não pode ser usado (falta
  // marcar o que tentou, ou confirmar que foi cliente) mantém o texto.
  function mudarViu(novo: OQueViu) {
    setViu(novo);
    if (!partes || editadoAMao || m.channel === 'phone') return;
    const gerado = montarMensagem(partes, novo, segmento, e?.state);
    if (gerado) setTexto(gerado);
  }
  const estiloAtual = viu.estilo ?? '';
  const bloqueio = estiloAtual ? bloqueioDoEstilo(estiloAtual, viu, e?.state) : '';

  const corpo = `${texto.trim()}${rodape}`;
  const mudou = corpo !== m.body;
  // Todos os números: o principal primeiro. No WhatsApp dá para escolher
  // para qual mandar (celular ou fixo com WhatsApp confirmado).
  const telefones = telefonesDe(e);
  const paraZap = telefones.filter(podeWhatsapp);
  const destinoValido = paraZap.some(t => t.digitos === destino) ? destino : (paraZap[0]?.digitos ?? '');
  const zap = m.channel === 'whatsapp' ? whatsappDoNumero(destinoValido || m.empresa_telefone) : null;
  const linkZap = zap ? `${zap}?text=${encodeURIComponent(corpo)}` : null;
  const ligar = m.channel === 'phone' ? linkLigar(m.empresa_telefone) : null;
  const email = m.channel === 'email' && e?.main_email
    ? `mailto:${e.main_email}?subject=${encodeURIComponent(m.subject ?? '')}&body=${encodeURIComponent(corpo)}` : null;
  const busca = buscasEmpresa({ name: m.empresa_nome, city: m.empresa_cidade, address_line: e?.address_line ?? null, metadata: e?.metadata ?? null });
  const site = urlSegura(e?.website_url);
  const insta = urlSegura(e?.instagram_url);
  const bloqueada = !!m.empresa_opt_out;
  const viuPreenchido = !!(viu.onde || viu.nota || viu.observacao || viu.estilo);

  async function salvarSeMudou() {
    if (mudou || viuPreenchido) await acoes.salvar(m, corpo, viuPreenchido ? viu : null);
    if (scriptId && scriptId !== m.template_id) await acoes.usarScript(m, scriptId);
  }
  function aplicarScript() {
    if (!escolhido) return;
    const valores: Record<string, string> = {
      nome: m.empresa_nome.trim(), bairro: bairroScript.trim(),
      nota: notaScript.trim(), avaliacoes: avaliacoesScript.trim(),
    };
    const faltam = (escolhido.variaveis_obrigatorias ?? []).filter(v => !valores[v]);
    if (faltam.length) { setErro(`Preencha: ${faltam.join(', ')}.`); return; }
    if (valores.nota && (!Number.isFinite(Number(valores.nota.replace(',', '.'))) || Number(valores.nota.replace(',', '.')) < 4 || Number(valores.nota.replace(',', '.')) > 5)) {
      setErro('Use apenas uma nota do Google conferida, de 4,0 a 5,0.'); return;
    }
    if (valores.avaliacoes && (!/^\d+$/.test(valores.avaliacoes) || Number(valores.avaliacoes) < 1)) {
      setErro('Confira a quantidade de avaliações no Google.'); return;
    }
    if (/não (?:encontrei|achei)/i.test(escolhido.body_template) && !conferiuPesquisa) {
      setErro('Confira no site ou no Google o que o roteiro diz que você não encontrou.'); return;
    }
    const preenchido = escolhido.body_template.replace(/\{([a-z_]+)\}/g, (trecho, chave: string) => valores[chave] ?? trecho);
    if (/\{[a-z_]+\}/.test(preenchido)) { setErro('Ainda há dados faltando neste roteiro.'); return; }
    setTexto(preenchido);
    setScriptId(escolhido.id);
    setEditadoAMao(true);
    setErro('');
  }
  async function executar(f: () => Promise<void>) {
    setErro('');
    try { await f(); } catch (err) { setErro(err instanceof Error ? err.message : 'Não foi possível concluir.'); }
  }

  return <div className="seq">
    <div className="cartao">
      <div className="seq-topo">
        <div><h2>{m.empresa_nome}</h2><div className="muted">{brief?.segmento ?? e?.category ?? 'Negócio local'}{m.empresa_cidade && ` · ${m.empresa_cidade}`}{(paraZap.find(t => t.digitos === destinoValido)?.formatado ?? m.empresa_telefone) && ` · ${paraZap.find(t => t.digitos === destinoValido)?.formatado ?? m.empresa_telefone}`}</div></div>
        <SeloCanal canal={m.channel as 'whatsapp'}/>
      </div>
      {bloqueada && <p className="aviso erro">Empresa marcada como não contatar. Não envie.</p>}

      <div className="olhar">
        <span className="muted">Antes de mandar, olhe (30 s):</span>
        <a className="btn btn-s pequeno" href={busca.google} target="_blank" rel="noreferrer"><Search size={14}/> Google</a>
        <a className="btn btn-s pequeno" href={busca.maps} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Maps</a>
        {busca.endereco && <a className="btn btn-s pequeno" href={busca.endereco} target="_blank" rel="noreferrer" title="Abre o endereço no mapa: dá para ver a fachada"><ExternalLink size={14}/> Endereço</a>}
        {busca.cnpj && <a className="btn btn-s pequeno" href={busca.cnpj} target="_blank" rel="noreferrer" title="Procura o CNPJ no Google: às vezes aparece outro telefone ou o Instagram"><Search size={14}/> CNPJ</a>}
        {insta && <a className="btn btn-s pequeno" href={insta} target="_blank" rel="noreferrer"><Camera size={14}/> Instagram</a>}
        {site && <a className="btn btn-s pequeno" href={site} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Site</a>}
      </div>

      <p className="muted dica-busca">Não achou no Google? É comum em empresa pequena. Aí escolha “Não encontrei no Google” ou deixe sem citar.</p>
      {m.channel === 'whatsapp' && paraZap.length > 1 && <div className="destino">
        <span className="rotulo">Mandar para</span>
        <div className="chips" role="radiogroup" aria-label="Número de destino">
          {paraZap.map(t => <button key={t.digitos} type="button" role="radio" aria-checked={destinoValido === t.digitos} aria-pressed={destinoValido === t.digitos}
            className="chip" onClick={() => setDestino(t.digitos)}>{t.formatado} <small>{t.tipo}{t.principal ? ' · principal' : ''}</small></button>)}
        </div>
      </div>}
      {m.channel === 'whatsapp' && e && !bloqueada && paraZap.find(t => t.digitos === destinoValido)?.inferido && <div className="aviso pequeno inferido">
        <span>Este celular veio do cadastro da Receita sem o 9 (formato antigo) e o 9 foi acrescentado pela regra da Anatel. <strong>Ao abrir o WhatsApp, confira se o nome ou a foto é da empresa antes de enviar.</strong></span>
        <button type="button" className="btn btn-s pequeno perigo" disabled={ocupado}
          onClick={() => { if (confirm('O WhatsApp abriu com o nome de outra pessoa? O número sai da empresa e vai para a lista de não contatar.')) acoes.descartarTelefone(e.id, destinoValido); }}>É de outra pessoa</button>
      </div>}
      {telefones.length > 1 && e && !bloqueada && <details className="outros-numeros">
        <summary>{telefones.length} números desta empresa</summary>
        <ListaTelefones telefones={telefones} ocupado={ocupado} compacta confirmar={(t, tem) => acoes.confirmarWhatsapp(e.id, tem, t)} usar={t => acoes.usarTelefone(e.id, t)} descartar={t => acoes.descartarTelefone(e.id, t)}/>
      </details>}

      {m.channel !== 'phone' && partes && <div className="estilos">
        <span className="rotulo">Como abrir a conversa</span>
        <div className="chips" role="radiogroup" aria-label="Jeito de abrir">
          {Object.entries(ESTILOS).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={estiloAtual === k} aria-pressed={estiloAtual === k}
            className="chip" title={v.quando} disabled={k === 'vizinho' && !!e?.state && e.state !== 'RJ'}
            onClick={() => mudarViu({ ...viu, estilo: k })}>{v.rotulo}</button>)}
        </div>
        <small className="muted">{estiloAtual ? ESTILOS[estiloAtual]?.quando : 'Escolha um jeito. Até lá, vale o texto escrito pelas regras.'}</small>
        {estiloAtual === 'cliente' && <label className="checkbox-linha">
          <input type="checkbox" checked={!!viu.aconteceu} onChange={ev => mudarViu({ ...viu, aconteceu: ev.target.checked })}/>
          Eu procurei como cliente de verdade (senão, use “Pesquisa”)
        </label>}
        {bloqueio && <p className="aviso pequeno">{bloqueio}</p>}
      </div>}
      {m.channel !== 'phone' && (partes ? <div className="viu">
        <label className="campo">Onde viu
          <select value={viu.onde} onChange={ev => mudarViu({ ...viu, onde: ev.target.value })}><option value="">Não citar</option>{Object.entries(ONDE_VIU).map(([k, v]) => <option key={k} value={k}>{v.replace(/^no /, '').replace(/^aqui na /, '')}</option>)}</select>
        </label>
        <label className="campo" title="Só entra na mensagem se for 4,0 ou mais. Nota baixa nunca é citada.">Nota Google
          <input inputMode="decimal" maxLength={3} placeholder="4,8" value={viu.nota} onChange={ev => mudarViu({ ...viu, nota: ev.target.value.replace(/[^\d,.]/g, '') })}/>
        </label>
        <label className="campo largo">O que você tentou e não achou
          <select value={viu.observacao} onChange={ev => mudarViu({ ...viu, observacao: ev.target.value })}>
            <option value="">Nada a comentar</option>
            {Object.entries(observacoesDo(segmento)).map(([k, v]) => <option key={k} value={k}>{maiuscula(v.replace(/^(Só |O Instagram está bonito, só )/, '').replace(/\.$/, ''))}</option>)}
            <option value="outra">Outra coisa (escrever)</option>
          </select>
        </label>
        {viu.observacao === 'outra' && <label className="campo largo">Escreva como constatação sua
          <input maxLength={200} placeholder="Ex.: Só não achei o cardápio de sobremesas." value={viu.outra} onChange={ev => mudarViu({ ...viu, outra: ev.target.value })}/>
        </label>}
      </div> : <p className="dica">Esta mensagem foi escrita antes da atualização. Edite à mão se quiser citar o que viu.</p>)}

      {scriptsPrimeiroContato.length > 0 && <div className="estilos">
        <label className="campo">Roteiro de primeiro contato
          <select value={escolhaScript} onChange={ev => { setEscolhaScript(ev.target.value); setErro(''); }}>
            <option value="">Manter o rascunho atual</option>
            {scriptsPrimeiroContato.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {escolhido && <>
          <div className="viu">
            {escolhido.body_template.includes('{bairro}') && <label className="campo">Bairro conferido
              <input value={bairroScript} maxLength={80} onChange={ev => setBairroScript(ev.target.value)}/>
            </label>}
            {escolhido.body_template.includes('{nota}') && <label className="campo">Nota no Google
              <input inputMode="decimal" placeholder="4,7" value={notaScript} maxLength={3} onChange={ev => setNotaScript(ev.target.value)}/>
            </label>}
            {escolhido.body_template.includes('{avaliacoes}') && <label className="campo">Avaliações no Google
              <input inputMode="numeric" placeholder="120" value={avaliacoesScript} maxLength={7} onChange={ev => setAvaliacoesScript(ev.target.value)}/>
            </label>}
          </div>
          {/não (?:encontrei|achei)/i.test(escolhido.body_template) && <label className="checkbox-linha">
            <input type="checkbox" checked={conferiuPesquisa} onChange={ev => setConferiuPesquisa(ev.target.checked)}/>
            Conferi pessoalmente o que o roteiro diz que não encontrei.
          </label>}
          <button type="button" className="btn btn-s" onClick={aplicarScript}>Aplicar roteiro ao rascunho</button>
        </>}
      </div>}

      {m.channel === 'phone'
        ? <><p className="rotulo">Roteiro da ligação</p><pre className="texto-mensagem">{corpo}</pre></>
        : <label className="campo">{m.channel === 'email' ? `E-mail · assunto: ${m.subject ?? ''}` : 'Mensagem (pode editar)'}
            <textarea value={texto} maxLength={3500} onChange={ev => { setTexto(ev.target.value); setEditadoAMao(true); }}/>
            {rodape && <small className="muted">Vai junto, sempre: “{rodape.trim().split('\n').filter(Boolean)[0].replace(/[.…]+$/, '').slice(0, 90)}…”</small>}
          </label>}

      {erro && <p className="aviso erro" role="alert">{erro}</p>}
      {enviadasHoje >= META_DIA && m.channel === 'whatsapp' && <p className="aviso">Você já mandou {enviadasHoje} hoje. Mais que {META_DIA} conversas novas por dia arrisca bloqueio do número.</p>}

      <div className="botoes-seq">
        {(mudou || (scriptId && scriptId !== m.template_id)) && <button type="button" className="btn btn-s btn-grande" disabled={ocupado || bloqueada}
          onClick={() => executar(async () => { await salvarSeMudou(); })}>Salvar rascunho</button>}
        {linkZap && !bloqueada && <a className="btn btn-zap btn-grande" href={linkZap} target="_blank" rel="noreferrer"
          onClick={() => { void salvarSeMudou().catch(err => setErro(err instanceof Error ? err.message : 'Não foi possível salvar o rascunho.')); }}><MessageCircle size={18}/> Abrir no WhatsApp</a>}
        {ligar && !bloqueada && <a className="btn btn-lig btn-grande" href={ligar}><Phone size={18}/> Ligar</a>}
        {email && !bloqueada && <a className="btn btn-mail btn-grande" href={email} onClick={() => { void salvarSeMudou().catch(err => setErro(err instanceof Error ? err.message : 'Não foi possível salvar o rascunho.')); }}><Mail size={18}/> Abrir no e-mail</a>}
        <button type="button" className="btn btn-p btn-grande" disabled={ocupado || bloqueada}
          onClick={() => executar(async () => { await salvarSeMudou(); await acoes.enviada(m); })}>
          {m.channel === 'phone' ? 'Liguei' : 'Marquei como enviada'} <ArrowRight size={18}/></button>
        <button type="button" className="btn btn-s" disabled={ocupado} onClick={pular}><SkipForward size={16}/> Pular</button>
        <button type="button" className="btn btn-s" disabled={ocupado || bloqueada} onClick={() => {
          if (confirm(`Marcar ${m.empresa_nome} como não contatar? Ela não será abordada de novo.`)) void executar(() => acoes.naoContatar(m));
        }}><Ban size={16}/> Não contatar</button>
      </div>
      <div className="acoes secundarias">
        {m.channel !== 'phone' && <BotaoCopiar texto={corpo} rotulo="Copiar texto"/>}
        {m.channel === 'phone' && e && !bloqueada && telefones.length <= 1 && <ListaTelefones telefones={telefones} ocupado={ocupado} compacta confirmar={(t, tem) => acoes.confirmarWhatsapp(e.id, tem, t)} usar={t => acoes.usarTelefone(e.id, t)} descartar={t => acoes.descartarTelefone(e.id, t)}/>}
        {m.channel === 'phone' && !bloqueada && <AcharWhatsapp nome={m.empresa_nome} cidade={m.empresa_cidade}/>}
        <button type="button" className="btn btn-s" onClick={() => acoes.abrir(m.company_id)}>Ver ficha</button>
        <span className="muted">{posicao} de {total}</span>
      </div>
    </div>

    <div className="grade coluna">
      <div className="cartao"><Continuacao brief={brief} contextoMaps={viu.observacao === 'nao_google' || e?.metadata?.observacoes?.observacao === 'nao_google'} bloqueada={bloqueada}/></div>
      <div className="cartao respostas">
        <h3>Respostas prontas</h3>
        {brief?.respostas_prontas?.length
          ? brief.respostas_prontas.filter(r => !r.situacao.startsWith('Me manda mais informações')).map(r => <details key={r.situacao}><summary>“{r.situacao}”</summary><p>{r.resposta}</p>
              <div className="acoes"><BotaoCopiar texto={r.resposta} rotulo="Copiar"/>
                {r.depois === 'nao_contatar' && <span className="muted">Depois: marque “Não contatar”.</span>}
                {r.depois === 'agendar_retorno' && <span className="muted">Depois: na ficha, agende o retorno.</span>}</div></details>)
          : <p className="muted">As respostas prontas aparecem depois que a empresa for analisada de novo.</p>}
      </div>
      {brief?.o_que_evitar?.length ? <div className="cartao"><h3>Cuidados</h3><ul className="cuidados">{brief.o_que_evitar.map(x => <li key={x}>{x}</li>)}</ul></div> : null}
    </div>
  </div>;
}

export default function PassoContatar({ dados: d, canalInicial, mensagemInicial, ocupado, acoes }: {
  dados: DadosPainel; canalInicial: string; mensagemInicial: string; ocupado: boolean; acoes: Acoes;
}) {
  const porCanal = (c: string) => d.mensagens.filter(m => m.channel === c && !m.empresa_opt_out);
  const canais: Array<[string, string]> = [['whatsapp', 'WhatsApp'], ['phone', 'Ligação'], ['email', 'E-mail']];
  const primeiroComItens = canais.find(([c]) => porCanal(c).length)?.[0] ?? 'whatsapp';
  const [canal, setCanal] = useState(canais.some(([c]) => c === canalInicial) ? canalInicial : primeiroComItens);
  const lista = porCanal(canal);
  const [atualId, setAtualId] = useState(mensagemInicial || lista[0]?.id || '');
  const [ultimaPosicao, setUltimaPosicao] = useState(0);
  const [pulados, setPulados] = useState<string[]>([]);

  // Pulados vão para o fim da fila (só nesta visita).
  const ordem = [...lista.filter(m => !pulados.includes(m.id)), ...lista.filter(m => pulados.includes(m.id))];
  let indice = ordem.findIndex(m => m.id === atualId);
  // Depois de enviar, a mensagem sai da lista: fica a que estava na mesma posição.
  if (indice < 0) indice = Math.min(ultimaPosicao, ordem.length - 1);
  const atual = ordem[indice];
  useEffect(() => { if (atual && atual.id !== atualId) setAtualId(atual.id); }, [atual, atualId]);
  useEffect(() => { if (indice >= 0) setUltimaPosicao(indice); }, [indice]);

  const feitasHoje = d.funil.enviadas_hoje;
  const totalCanal = d.funil.rascunhos[canal] ?? lista.length;

  return <section aria-labelledby="titulo-contatar">
    <div className="cabeca">
      <div><h1 id="titulo-contatar">Contatar</h1><p>Uma de cada vez. Olhe, ajuste, mande, marque e vá para a próxima.</p></div>
      <div className="chips" role="radiogroup" aria-label="Canal">
        {canais.map(([c, rotulo]) => <button key={c} type="button" role="radio" aria-checked={canal === c} className="chip" aria-pressed={canal === c}
          onClick={() => { setCanal(c); setAtualId(porCanal(c)[0]?.id ?? ''); setUltimaPosicao(0); }}>{rotulo} · {d.funil.rascunhos[c] ?? porCanal(c).length}</button>)}
      </div>
    </div>
    {atual ? <>
      <div className="progresso">
        <strong>{indice + 1} de {ordem.length}</strong>
        <div className="barra"><i style={{ width: `${Math.round(((indice + 1) / Math.max(ordem.length, 1)) * 100)}%` }}/></div>
        <span className="muted">{feitasHoje} {feitasHoje === 1 ? 'enviada' : 'enviadas'} hoje · meta {META_DIA}</span>
      </div>
      {totalCanal > ordem.length && <p className="muted">Mostrando as {ordem.length} de maior prioridade. As outras aparecem conforme você envia.</p>}
      <Sequencia key={atual.id} m={atual} scripts={d.scripts} posicao={indice + 1} total={ordem.length} enviadasHoje={feitasHoje} ocupado={ocupado}
        acoes={acoes} pular={() => { setPulados([...pulados.filter(x => x !== atual.id), atual.id]); setAtualId(ordem[(indice + 1) % ordem.length]?.id ?? ''); }}/>
    </> : <p className="vazio">{canal === 'whatsapp'
      ? 'Nenhuma mensagem de WhatsApp pronta. Traga empresas em 1 · Encontrar ou teste o WhatsApp dos fixos em 2 · Qualificar.'
      : 'Nada pronto neste canal agora.'}</p>}
  </section>;
}
