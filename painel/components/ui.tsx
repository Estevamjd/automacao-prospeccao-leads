"use client";

import { useState } from 'react';
import { Check, CircleHelp, Copy, ExternalLink, MessageCircle, Phone, Search, Star, X } from 'lucide-react';
import { buscasWhatsapp, linkLigar, whatsappDoNumero } from '@/lib/comercial';
import { podeWhatsapp, type Telefone } from '@/lib/telefones';

/** Ícone de ajuda com explicação curta (hover no computador, toque no celular). */
export function Ajuda({ texto }: { texto: string }) {
  return <span className="ajuda"><button type="button" aria-label={texto}><CircleHelp size={15} /></button><span role="tooltip">{texto}</span></span>;
}

/** Botão de copiar com o próprio estado de "Copiado" e erro. */
export function BotaoCopiar({ texto, rotulo, desativado, classe = 'btn btn-s' }: { texto: string; rotulo: string; desativado?: boolean; classe?: string }) {
  const [estado, setEstado] = useState<'' | 'ok' | 'erro'>('');
  return <>
    <button type="button" className={classe} disabled={desativado} onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setEstado('ok'); setTimeout(() => setEstado(''), 2500); } catch { setEstado('erro'); }
    }}>{estado === 'ok' ? <Check size={16}/> : <Copy size={16}/>} {estado === 'ok' ? 'Copiado' : rotulo}</button>
    {estado === 'erro' && <p className="aviso erro" role="alert">Não foi possível copiar. Selecione o texto e copie.</p>}
  </>;
}

/**
 * Atalhos para achar o WhatsApp de quem só tem fixo nas fontes. Abre a busca
 * no Google/Maps; quem confere e salva o número é o Estevam (ficha → dados).
 * Não raspa nada.
 */
export function AcharWhatsapp({ nome, cidade }: { nome: string; cidade: string | null }) {
  const b = buscasWhatsapp(nome, cidade);
  return <>
    <a className="btn btn-s" href={b.google} target="_blank" rel="noreferrer"><Search size={16}/> Achar WhatsApp</a>
    <a className="btn btn-s" href={b.maps} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Ver no Maps</a>
  </>;
}

/**
 * "Testar WhatsApp no fixo": abre wa.me com o número fixo. Se a conversa
 * abrir, é WhatsApp Business no fixo. Depois o Estevam confirma (sim/não) e o
 * banco muda o canal. Um teste por vez, aberto por ele: nada de checagem em
 * massa de números (é o que faz o WhatsApp bloquear a conta).
 */
export function TestarWhatsapp({ telefone, confirmar, ocupado, rotulo = 'Testar WhatsApp no fixo', classe = 'btn btn-s' }: {
  telefone: string | null; ocupado: boolean; confirmar: (tem: boolean) => void; rotulo?: string; classe?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const link = whatsappDoNumero(telefone);
  if (!link) return null;
  if (!aberto) {
    return <a className={classe} href={link} target="_blank" rel="noreferrer" onClick={() => setAberto(true)}>
      <MessageCircle size={16}/> {rotulo}
    </a>;
  }
  return <span className="testar-zap" role="group" aria-label="Resultado do teste">
    <span>A conversa abriu?</span>
    <button type="button" className="btn btn-zap" disabled={ocupado} onClick={() => confirmar(true)}><Check size={16}/> Tem WhatsApp</button>
    <button type="button" className="btn btn-s" disabled={ocupado} onClick={() => confirmar(false)}><X size={16}/> Não tem</button>
  </span>;
}

/**
 * Todos os números da empresa (30/09), cada um com o que dá para fazer nele:
 * WhatsApp (celular ou fixo testado), testar WhatsApp (fixo não testado),
 * ligar, e "usar este" para trocar o principal (para onde a mensagem vai).
 */
export function ListaTelefones({ telefones, ocupado, confirmar, usar, descartar, compacta }: {
  telefones: Telefone[]; ocupado: boolean; compacta?: boolean;
  confirmar: (digitos: string, tem: boolean) => void;
  usar: (digitos: string) => void;
  /** "Número errado": sai da empresa e vai para a lista de não contatar. */
  descartar?: (digitos: string) => void;
}) {
  if (!telefones.length) return null;
  return <div className={`telefones ${compacta ? 'compacta' : ''}`}>
    {telefones.length > 1 && <span className="rotulo-tel">{telefones.length} números</span>}
    {telefones.map(t => {
      const zap = podeWhatsapp(t) ? whatsappDoNumero(t.digitos) : null;
      const ligar = linkLigar(t.digitos);
      return <div className={`telefone ${t.principal ? 'principal' : ''}`} key={t.digitos}>
        <span className="numero">
          {t.principal && <Star size={13} aria-label="Principal"/>}
          <strong>{t.formatado}</strong>
          <small>{t.tipo}{t.whatsapp === true ? ' · WhatsApp ✓' : t.whatsapp === false ? ' · sem WhatsApp' : ''}{t.principal ? ' · principal' : ''}</small>
          {t.inferido && t.whatsapp !== true && <span className="selo-inferido" title="O cadastro da Receita trouxe este celular sem o 9 (formato antigo). O 9 foi acrescentado pela regra da Anatel. Ao abrir o WhatsApp, confira se o nome é da empresa.">9 acrescentado</span>}
        </span>
        <span className="acoes-tel">
          {zap && <a className="btn btn-s pequeno" href={zap} target="_blank" rel="noreferrer" title="Abrir conversa no WhatsApp"><MessageCircle size={14}/>{compacta ? '' : ' WhatsApp'}</a>}
          {!zap && t.tipo === 'fixo' && t.whatsapp === null && <TestarWhatsapp telefone={t.digitos} ocupado={ocupado} rotulo={compacta ? 'Testar' : 'Testar WhatsApp'} classe="btn btn-s pequeno" confirmar={tem => confirmar(t.digitos, tem)}/>}
          {ligar && <a className="btn btn-s pequeno" href={ligar} title="Ligar"><Phone size={14}/>{compacta ? '' : ' Ligar'}</a>}
          {!t.principal && <button type="button" className="btn btn-s pequeno" disabled={ocupado} onClick={() => usar(t.digitos)} title="Mandar as mensagens para este número">Usar este</button>}
          {descartar && <button type="button" className="btn btn-s pequeno perigo" disabled={ocupado} title="O número é de outra pessoa: sai da empresa e vai para a lista de não contatar"
            onClick={() => { if (confirm(`${t.formatado} não é da empresa? Ele sai da ficha e vai para a lista de não contatar.`)) descartar(t.digitos); }}>Errado</button>}
        </span>
      </div>;
    })}
  </div>;
}
