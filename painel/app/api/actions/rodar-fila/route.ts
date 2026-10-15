import { NextResponse } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { chamarFuncao } from "@/lib/funcoes";

export const maxDuration = 300;

export async function POST(request: Request) {
  // Pedido vindo de outro site não grava nada (mesma proteção das outras rotas).
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Faça login." }, { status: 401 });

  const corpo = await request.json().catch(() => ({}));
  const quantidade = Math.min(Math.max(Number(corpo.quantidade) || 5, 1), 20);

  const { data: workspaces } = await supabase.from("workspaces").select("id").limit(1);
  const workspaceId = workspaces?.[0]?.id;
  if (!workspaceId) {
    return NextResponse.json({ error: "Nenhum workspace ligado à sua conta." }, { status: 404 });
  }

  const funcao = process.env.USE_AI_AGENT_RUNNER === "true" ? "agent-runner" : "rules-runner";

  let processadas = 0;
  const erros: string[] = [];

  // A função pega a tarefa de forma atômica (claim_next_task). Por isso dá
  // para clicar duas vezes no botão sem processar o mesmo lead duas vezes —
  // era o achado G4 da auditoria.
  for (let i = 0; i < quantidade; i += 1) {
    try {
      const resultado = await chamarFuncao<{ processadas?: number }>(funcao, {
        workspace_id: workspaceId,
        worker: `painel:${user.id.slice(0, 8)}`,
        provider: process.env.DEFAULT_LLM_PROVIDER ?? "openai",
      });

      if (!resultado.processadas) break; // fila vazia
      processadas += resultado.processadas;
    } catch (erro) {
      erros.push(erro instanceof Error ? erro.message : String(erro));
      break;
    }
  }

  return NextResponse.json({
    mensagem: processadas === 0
      ? "Nenhuma tarefa pendente agora."
      : `${processadas} ${processadas === 1 ? "tarefa processada" : "tarefas processadas"}.`,
    processadas,
    modo: funcao === "agent-runner" ? "com IA" : "por regras",
    erros,
  });
}
