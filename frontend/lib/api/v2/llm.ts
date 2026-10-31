/**
 * The language model behind Aletheia (api/routes/llm_settings.py): GET /settings/llm/providers, GET and PUT
 * /settings/llm, POST /settings/llm/test, all manage_llm. The key is never read back, only a masked preview; a save or
 * a test with an empty key keeps the stored one.
 */
import { v2Get, v2Send } from "./client";

export interface LlmProvider {
  label: string;
  description: string;
  requires_api_key: boolean;
  requires_base_url: boolean;
  default_base_url: string;
  default_model: string;
}

export interface LlmConfig {
  provider: string;
  model: string;
  base_url: string;
  has_api_key: boolean;
  api_key_preview: string;
  temperature: number;
  max_tokens: number;
  request_timeout: number;
  azure_deployment: string;
  azure_api_version: string;
  /** database once saved here; environment while the deployment's .env still decides. */
  source: "database" | "environment";
  updated_at?: string | null;
  updated_by?: string | null;
}

export type LlmBody = Pick<LlmConfig, "provider" | "model" | "base_url" | "temperature" | "max_tokens" | "request_timeout" | "azure_deployment" | "azure_api_version"> & { api_key: string };

export const getLlmProviders = (): Promise<{ providers: Record<string, LlmProvider> }> => v2Get("/settings/llm/providers");
export const getLlmConfig = (): Promise<LlmConfig> => v2Get("/settings/llm");
export const putLlmConfig = (body: LlmBody): Promise<{ status: string; provider: string; model: string }> => v2Send("PUT", "/settings/llm", body);
export const testLlm = (body: LlmBody): Promise<{ success: boolean; message: string; response_preview: string }> => v2Send("POST", "/settings/llm/test", body);
