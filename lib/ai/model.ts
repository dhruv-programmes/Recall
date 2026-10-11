import { createOpenAI } from "@ai-sdk/openai";
import { openAiApiKey, openRouterApiKey, openRouterModel } from "@/lib/env";

function openAiModelId(model: string) {
  return model.startsWith("openai/") ? model.slice("openai/".length) : "gpt-4o-mini";
}

export function getChatModel() {
  const model = openRouterModel();
  const openRouterKey = openRouterApiKey();
  if (openRouterKey) {
    const openrouter = createOpenAI({
      apiKey: openRouterKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
    return openrouter.chat(model);
  }
  const openaiKey = openAiApiKey();
  if (openaiKey) {
    const openai = createOpenAI({ apiKey: openaiKey });
    return openai.chat(openAiModelId(model));
  }
  throw new Error("Set OPENROUTER_API_KEY in .env, or OPENAI_API_KEY as a fallback.");
}

export function modelHealth() {
  const model = openRouterModel();
  if (openRouterApiKey()) {
    return {
      ok: true,
      model,
      detail: `Notes and questions use OpenRouter (${model}).`,
    };
  }
  if (openAiApiKey()) {
    const id = openAiModelId(model);
    return {
      ok: true,
      model: id,
      detail: `Notes and questions use OpenAI (${id}).`,
    };
  }
  return {
    ok: false,
    model,
    detail: "Set OPENROUTER_API_KEY in .env, then restart the app.",
  };
}
