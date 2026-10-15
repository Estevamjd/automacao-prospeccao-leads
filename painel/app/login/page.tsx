"use client";

import { useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/client";

/**
 * Entrada por link mágico (magic link): sem senha para vazar, sem
 * gerenciamento de recuperação. Apenas contas criadas pelo proprietário
 * podem solicitar o link; o cadastro público permanece fechado.
 */
export default function Login() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"parado" | "enviando" | "enviado" | "erro">("parado");
  const [mensagem, setMensagem] = useState("");

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setEstado("enviando");

    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setEstado("erro");
      setMensagem(error.message);
      return;
    }

    setEstado("enviado");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Painel de Prospecção</h1>
        <p className="mt-1 text-sm text-slate-500">
          Entre com seu e-mail. Você recebe um link de acesso.
        </p>

        {estado === "enviado" ? (
          <div className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
            Link enviado para <strong>{email}</strong>. Abra o e-mail para entrar.
          </div>
        ) : (
          <form onSubmit={entrar} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium">E-mail</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-700"
                placeholder="voce@exemplo.com"
                autoComplete="email"
              />
            </div>

            {estado === "erro" && (
              <p className="text-sm text-red-600">{mensagem}</p>
            )}

            <button
              type="submit"
              disabled={estado === "enviando"}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {estado === "enviando" ? "Enviando..." : "Receber link de acesso"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
