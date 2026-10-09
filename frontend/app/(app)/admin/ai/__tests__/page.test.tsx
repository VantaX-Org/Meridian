import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as llmApi from "@/lib/api/llm-settings";
import type { LLMConfig, LLMProvider } from "@/lib/api/llm-settings";
import AdminAIPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const PROVIDERS: Record<string, LLMProvider> = {
  anthropic: { label: "Anthropic", description: "Claude", requires_api_key: true, requires_base_url: false, default_base_url: "", default_model: "claude" },
};
const CONFIG: LLMConfig = {
  provider: "anthropic", model: "claude", base_url: "", has_api_key: true, api_key_preview: "sk-***",
  temperature: 0.2, max_tokens: 1000, request_timeout: 120, azure_deployment: "", azure_api_version: "",
  source: "database", updated_at: "2026-01-01T00:00:00Z", updated_by: "ana@example.com",
};

describe("admin AI page", () => {
  it("renders the provider form once loaded", async () => {
    vi.spyOn(llmApi, "getLLMProviders").mockResolvedValue(PROVIDERS);
    vi.spyOn(llmApi, "getLLMConfig").mockResolvedValue(CONFIG);
    renderWithQuery(<AdminAIPage />);
    await waitFor(() => expect(screen.getAllByText("Anthropic").length).toBeGreaterThan(0));
  });

  it("shows a retryable error when settings fail to load", async () => {
    const spy = vi.spyOn(llmApi, "getLLMConfig").mockRejectedValue(new Error("network down"));
    vi.spyOn(llmApi, "getLLMProviders").mockResolvedValue(PROVIDERS);
    renderWithQuery(<AdminAIPage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue(CONFIG);
    retry.click();
    await waitFor(() => expect(screen.getAllByText("Anthropic").length).toBeGreaterThan(0));
  });
});
