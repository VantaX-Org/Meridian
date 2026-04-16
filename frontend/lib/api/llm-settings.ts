import apiClient from "./client";

export interface LLMProvider {
  label: string;
  description: string;
  requires_api_key: boolean;
  requires_base_url: boolean;
  default_base_url: string;
  default_model: string;
}

export interface LLMConfig {
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
  source: "database" | "environment";
  updated_at: string | null;
  updated_by: string | null;
}

export interface LLMConfigUpdate {
  provider: string;
  model?: string;
  base_url?: string;
  api_key?: string;
  temperature?: number;
  max_tokens?: number;
  request_timeout?: number;
  azure_deployment?: string;
  azure_api_version?: string;
}

export interface LLMTestResult {
  success: boolean;
  message: string;
  response_preview?: string;
}

export async function getLLMProviders(): Promise<Record<string, LLMProvider>> {
  const { data } = await apiClient.get<{ providers: Record<string, LLMProvider> }>(
    "/api/v1/settings/llm/providers"
  );
  return data.providers;
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const { data } = await apiClient.get<LLMConfig>("/api/v1/settings/llm");
  return data;
}

export async function updateLLMConfig(config: LLMConfigUpdate): Promise<void> {
  await apiClient.put("/api/v1/settings/llm", config);
}

export async function testLLMConnection(config: LLMConfigUpdate): Promise<LLMTestResult> {
  const { data } = await apiClient.post<LLMTestResult>("/api/v1/settings/llm/test", config);
  return data;
}
