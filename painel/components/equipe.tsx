"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, UserPlus, UserRoundX } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";

type Membro = { user_id: string; email: string; role: string; created_at: string };

export default function Equipe({ workspaceId }: { workspaceId: string }) {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [email, setEmail] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const chamar = useCallback(async (action: string, extra: Record<string, string> = {}) => {
    const { data, error } = await criarClienteNavegador().functions.invoke("team-members", {
      body: { action, workspace_id: workspaceId, ...extra },
    });
    if (error) {
      const resposta = error.context instanceof Response ? await error.context.json().catch(() => null) : null;
      throw new Error(resposta?.error ?? "Não foi possível atualizar a equipe.");
    }
    return data as { equipe?: Membro[]; mensagem?: string };
  }, [workspaceId]);

  const atualizar = useCallback(async () => {
    const data = await chamar("list");
    setMembros(data.equipe ?? []);
  }, [chamar]);

  useEffect(() => {
    void atualizar().catch((e: Error) => setErro(e.message));
  }, [atualizar]);

  async function adicionar(event: React.FormEvent) {
    event.preventDefault();
    setOcupado("add"); setErro(""); setAviso("");
    try {
      const data = await chamar("add", { email: email.trim() });
      await atualizar();
      setEmail("");
      setAviso(data.mensagem ?? "Acesso liberado.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível liberar o acesso."); }
    finally { setOcupado(""); }
  }

  async function remover(membro: Membro) {
    if (!window.confirm(`Remover o acesso de ${membro.email}?`)) return;
    setOcupado(membro.user_id); setErro(""); setAviso("");
    try {
      const data = await chamar("remove", { user_id: membro.user_id });
      await atualizar();
      setAviso(data.mensagem ?? "Acesso removido.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível remover o acesso."); }
    finally { setOcupado(""); }
  }

  return <section className="equipe">
    <div className="titulo-linha"><div><h1>Equipe</h1><p className="muted">Pessoas com acesso ao mesmo painel e às mesmas oportunidades.</p></div></div>
    <form className="equipe-form" onSubmit={adicionar}>
      <label htmlFor="equipe-email">E-mail da pessoa
        <input id="equipe-email" type="email" required maxLength={254} autoComplete="off" placeholder="pessoa@empresa.com" value={email} onChange={e => setEmail(e.target.value)} />
      </label>
      <button className="botao" type="submit" disabled={!!ocupado}>
        {ocupado === "add" ? <LoaderCircle size={16} className="girando" /> : <UserPlus size={16} />}
        Liberar acesso
      </button>
    </form>
    <p className="muted">Depois de liberar, a pessoa entra em <a href="/login">Entrar no painel</a> com esse e-mail e solicita o próprio link de acesso. Nenhum convite é enviado automaticamente.</p>
    <p className="muted">Integrantes podem visualizar e atualizar oportunidades, propostas e atividades. Apenas você gerencia os acessos.</p>
    {erro && <p className="aviso erro" role="alert">{erro}</p>}
    {aviso && <p className="aviso sucesso" role="status"><Check size={16}/>{aviso}</p>}
    <h2>Integrantes</h2>
    <div className="equipe-lista">{membros.map(membro => <div key={membro.user_id} className="equipe-linha">
      <div><strong>{membro.email}</strong><small>{membro.role === "owner" ? "Proprietário" : "Integrante"}</small></div>
      {membro.role !== "owner" && <button type="button" className="icone" title={`Remover acesso de ${membro.email}`} aria-label={`Remover acesso de ${membro.email}`} disabled={!!ocupado} onClick={() => void remover(membro)}><UserRoundX size={17}/></button>}
    </div>)}</div>
  </section>;
}
