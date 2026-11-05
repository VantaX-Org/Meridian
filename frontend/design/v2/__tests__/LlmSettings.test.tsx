import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureResponse, fixtureWrite } from "@/lib/api/v2/fixtures";
import { resetLlmFixture } from "@/lib/api/v2/fixtures/llm";
import type { LlmConfig } from "@/lib/api/v2/llm";
import { resetKeptOutcomes } from "../inspector/shared";
import { LlmBlock } from "../admin/llm";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "steward", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetLlmFixture();
  resetKeptOutcomes();
  h.allowed = "all";
  setUrl("/admin/settings?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const config = () => fixtureResponse<LlmConfig>("/settings/llm", {});

describe("language model settings", () => {
  it("needs a key for a cloud provider, tests it, then saves and masks it", async () => {
    renderWithQuery(<LlmBlock />);
    const block = await screen.findByRole("region", { name: "Language model" });
    expect(await within(block).findByTestId("llm-source")).toHaveTextContent("Set by the deployment's environment");
    fireEvent.change(within(block).getByLabelText("Provider"), { target: { value: "anthropic" } });
    expect(within(block).getByText("Anthropic (Claude) needs an API key.")).toBeInTheDocument();
    const save = within(block).getByRole("button", { name: "Save the model" });
    expect(save).toBeDisabled();
    fireEvent.change(within(block).getByLabelText(/^API key/), { target: { value: "sk-test-abcd1234" } });
    fireEvent.click(within(block).getByRole("button", { name: "Test the model" }));
    expect(await within(block).findByText("The model answered")).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(config().source).toBe("database"));
    expect(config().provider).toBe("anthropic");
    expect(config().api_key_preview.endsWith("1234")).toBe(true);
    expect(await within(block).findByText(/A key ending 1234 is stored/)).toBeInTheDocument();
  });

  it("the fixture refuses a cloud provider without a key, as the route does", () => {
    expect(() => fixtureWrite("PUT", "/settings/llm", { provider: "openai", model: "", base_url: "", api_key: "", temperature: 0.1, max_tokens: 8192, request_timeout: 120, azure_deployment: "", azure_api_version: "" }, {})).toThrow(/API key is required/);
  });

  it("the aggregates-only switch saves and reads back", async () => {
    renderWithQuery(<LlmBlock />);
    const block = await screen.findByRole("region", { name: "Language model" });
    const sw = await within(block).findByLabelText(/Aggregates only to the model/);
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    await waitFor(() => expect(config().aggregates_only).toBe(true));
    expect(await within(block).findByText("Only aggregates go to the model")).toBeInTheDocument();
    fireEvent.click(within(block).getByLabelText(/Aggregates only to the model/));
    await waitFor(() => expect(config().aggregates_only).toBe(false));
  });

  it("is hidden without manage_llm", () => {
    h.allowed = ["view"];
    renderWithQuery(<LlmBlock />);
    expect(screen.queryByRole("region", { name: "Language model" })).toBeNull();
  });
});
