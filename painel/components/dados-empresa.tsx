"use client";

import { useState } from 'react';
import { Pencil, Save, X, Check, ExternalLink } from 'lucide-react';
import type { Empresa } from '@/lib/tipos';
import { dataLocal, urlSegura } from '@/lib/comercial';

const CAMPOS = [
  ['main_phone','Telefone','tel'], ['main_email','E-mail','email'],
  ['website_url','Site','url'], ['instagram_url','Instagram','url'],
  ['address_line','Endereço','text'],
] as const;
type Campo = typeof CAMPOS[number][0];

export default function DadosEmpresa({ empresa, ocupado, salvar }: {
  empresa: Empresa; ocupado: boolean; salvar: (dados: Record<string,string>) => Promise<void>;
}) {
  const [editando,setEditando] = useState(false);
  const [valores,setValores] = useState<Record<Campo,string>>({main_phone:empresa.main_phone ?? '',main_email:empresa.main_email ?? '',website_url:empresa.website_url ?? '',instagram_url:empresa.instagram_url ?? '',address_line:empresa.address_line ?? ''});
  const [marcados,setMarcados] = useState<Partial<Record<Campo,boolean>>>({});
  const [erro,setErro] = useState('');
  if (!editando) return <>
    <dl className="dados-grid">{CAMPOS.map(([campo,nome,tipo]) => {
      const confirmado = empresa.manual_overrides?.[campo];
      const valor = empresa[campo];
      const link = tipo === 'url' ? urlSegura(valor) : null;
      return <div key={campo}><dt>{nome}</dt><dd>{link ? <a href={link} target="_blank" rel="noreferrer">{valor} <ExternalLink size={13}/></a> : valor || 'Não informado'}</dd>
        <small className={confirmado ? 'confirmado' : ''}>{confirmado ? <><Check size={12}/> Confirmado por você em {dataLocal(confirmado.confirmed_at)}</> : 'Dado da pesquisa, não confirmado'}</small>
        {confirmado && <small>Antes da confirmação: {confirmado.original || 'Não informado'}</small>}
      </div>;
    })}</dl>
    <button className="botao secundario" disabled={ocupado} onClick={()=>setEditando(true)}><Pencil size={16}/> Editar e confirmar dados</button>
  </>;
  return <form className="editar-dados" onSubmit={async event=>{
    event.preventDefault(); setErro('');
    const dados = Object.fromEntries(CAMPOS.filter(([campo])=>marcados[campo]).map(([campo])=>[campo,valores[campo].trim()]));
    if (!Object.keys(dados).length) { setErro('Marque os campos que você conferiu.'); return; }
    try { await salvar(dados); } catch(e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
  }}>
    <fieldset disabled={ocupado}>
      {CAMPOS.map(([campo,nome,tipo])=><div className="campo-confirmacao" key={campo}>
        <label>{nome}<input type={tipo} maxLength={500} value={valores[campo]} onChange={e=>{setValores({...valores,[campo]:e.target.value});setMarcados({...marcados,[campo]:true});}}/></label>
        <label className="checkbox"><input type="checkbox" checked={!!marcados[campo]} onChange={e=>setMarcados({...marcados,[campo]:e.target.checked})}/> Conferi {nome.toLowerCase()}</label>
      </div>)}
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
      <div className="acoes"><button className="botao" type="submit"><Save size={16}/>{ocupado ? 'Salvando…' : 'Salvar dados confirmados'}</button><button type="button" className="botao secundario" onClick={()=>setEditando(false)}><X size={16}/> Cancelar</button></div>
    </fieldset>
  </form>;
}
