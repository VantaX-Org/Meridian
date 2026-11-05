/** Language model settings fixture, shaped like api/routes/llm_settings.py. The key is kept only as a masked preview. */
import type { LlmBody, LlmConfig, LlmProvider } from "../llm";

export const NONE_LLM = Symbol("not a language model path");

const P = (label: string, requires_api_key: boolean, requires_base_url: boolean, default_base_url: string, default_model: string): LlmProvider => ({ label, description: "", requires_api_key, requires_base_url, default_base_url, default_model });
const PROVIDERS: Record<string, LlmProvider> = {
  ollama: P("Local Ollama", false, true, "http://ollama:11434", "llama3.2:3b"),
  ollama_cloud: P("Ollama Cloud", true, false, "https://ollama.com", "deepseek-v3.1:671b-cloud"),
  anthropic: P("Anthropic (Claude)", true, false, "", "claude-sonnet-4-6"),
  openai: P("OpenAI", true, false, "", "gpt-4o"),
  google: P("Google Gemini", true, false, "", "gemini-2.5-flash"),
  azure_openai: P("Azure OpenAI", true, true, "", "gpt-4o"),
  custom: P("Custom (BYOLLM)", false, true, "", "default"),
};

const initial = (): LlmConfig => ({ provider: "ollama", model: "llama3.2:3b", base_url: "http://ollama:11434", has_api_key: false, api_key_preview: "", temperature: 0.1, max_tokens: 8192, request_timeout: 120, azure_deployment: "", azure_api_version: "2024-08-01-preview", source: "environment", aggregates_only: false });
let config: LlmConfig | null = null;
const state = (): LlmConfig => (config ??= initial());

export const resetLlmFixture = (): void => { config = null; };

function refuse(status: number, detail: string): never {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
}

export function llmRead(path: string): unknown {
  if (path === "/settings/llm/providers") return { providers: PROVIDERS };
  if (path === "/settings/llm") return state();
  return NONE_LLM;
}

export function llmWrite(method: string, path: string, body: unknown): unknown {
  const b = body as LlmBody;
  if (method === "POST" && path === "/settings/llm/test") {
    const p = PROVIDERS[b.provider] ?? refuse(400, `Unsupported provider: ${b.provider}`);
    return p.requires_api_key && !b.api_key && !state().has_api_key
      ? { success: false, message: "Connection failed: AuthenticationError", response_preview: "" }
      : { success: true, message: `Connected to ${p.label} successfully`, response_preview: "READY" };
  }
  if (method === "PUT" && path === "/settings/llm/aggregates-only") {
    config = { ...state(), aggregates_only: (body as { aggregates_only: boolean }).aggregates_only };
    return { status: "ok", aggregates_only: config.aggregates_only };
  }
  if (method !== "PUT" || path !== "/settings/llm") return NONE_LLM;
  const p = PROVIDERS[b.provider] ?? refuse(400, `Unsupported provider: ${b.provider}`);
  const keyed = b.api_key ? true : state().has_api_key;
  if (p.requires_api_key && !keyed) refuse(422, `API key is required for ${p.label}`);
  const base_url = b.base_url || (p.requires_base_url ? p.default_base_url || refuse(422, `Base URL is required for ${p.label}`) : "");
  config = {
    ...b, base_url, model: b.model || p.default_model, has_api_key: keyed,
    api_key_preview: b.api_key ? `••••${b.api_key.slice(-4)}` : state().api_key_preview,
    aggregates_only: state().aggregates_only, source: "database", updated_at: new Date().toISOString(), updated_by: "u-me",
  };
  return { status: "ok", provider: b.provider, model: config.model };
}
