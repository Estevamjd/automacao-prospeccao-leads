import { requireEnv } from "./env.ts";

export type LlmProvider = "openai" | "anthropic";

export async function callJsonLlm(params: {
  provider: LlmProvider;
  system: string;
  user: unknown;
  model?: string;
}): Promise<Record<string, unknown>> {
  if (params.provider === "anthropic") {
    return callAnthropic(params.system, params.user, params.model ?? requireEnv("ANTHROPIC_MODEL"));
  }

  return callOpenAI(params.system, params.user, params.model ?? requireEnv("OPENAI_MODEL"));
}

async function callOpenAI(
  system: string,
  user: unknown,
  model: string,
): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `${system}\nResponda somente JSON valido.` },
        { role: "user", content: JSON.stringify(user) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI respondeu ${response.status}: ${body?.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  }

  const outputText = body.choices?.[0]?.message?.content;
  if (typeof outputText !== "string") {
    throw new Error("OpenAI response did not include message content.");
  }

  try {
    return JSON.parse(outputText) as Record<string, unknown>;
  } catch {
    throw new Error(`OpenAI devolveu texto que nao e JSON valido: ${outputText.slice(0, 200)}`);
  }
}

async function callAnthropic(
  system: string,
  user: unknown,
  model: string,
): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system,
      messages: [
        {
          role: "user",
          content: `Responda somente JSON valido.\n\n${JSON.stringify(user)}`,
        },
      ],
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Anthropic respondeu ${response.status}: ${body?.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  }

  const text = body.content?.find((part: { type: string }) => part.type === "text")?.text;
  if (typeof text !== "string") {
    throw new Error("Anthropic response did not include text content.");
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Anthropic devolveu texto que nao e JSON valido: ${text.slice(0, 200)}`);
  }
}
