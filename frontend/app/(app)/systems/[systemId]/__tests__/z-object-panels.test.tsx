import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/z-objects";
import { MappingSection, RulesSection } from "../z-object-panels";

let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const emptyOf = (title: string) => screen.getByText(title).closest("[data-state='empty']") as HTMLElement;

beforeEach(() => {
  allowed = true;
  vi.spyOn(api, "getZRegistry").mockResolvedValue({ total: 0, entries: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("RulesSection empty state", () => {
  it("offers New Z rule in the empty state, not again in the header, and it opens the drawer", async () => {
    vi.spyOn(api, "getZRules").mockResolvedValue({ templates: [], custom_rules: [] });
    renderWithQuery(<RulesSection canCreate />);
    await screen.findByText("No custom Z rules yet");
    expect(screen.getAllByRole("button", { name: "New Z rule" })).toHaveLength(1);
    await userEvent.click(within(emptyOf("No custom Z rules yet")).getByRole("button", { name: "New Z rule" }));
    expect(await screen.findByLabelText("Rule name")).toBeInTheDocument();
  });

  it("has no action without manage_rules", async () => {
    vi.spyOn(api, "getZRules").mockResolvedValue({ templates: [], custom_rules: [] });
    renderWithQuery(<RulesSection canCreate={false} />);
    await screen.findByText("No custom Z rules yet");
    expect(screen.queryByRole("button", { name: "New Z rule" })).toBeNull();
  });
});

describe("MappingSection empty states", () => {
  it("queues detection for the system from No custom object analysis yet", async () => {
    vi.spyOn(api, "getZMapping").mockRejectedValue({ isAxiosError: true, response: { status: 404, data: {} } });
    const detect = vi.spyOn(api, "detectZObjectsNow").mockResolvedValue({ queued: true, version_id: "v1" });
    renderWithQuery(<MappingSection systemId="s1" />);
    await screen.findByText("No custom object analysis yet");
    await userEvent.click(within(emptyOf("No custom object analysis yet")).getByRole("button", { name: "Detect now" }));
    await waitFor(() => expect(detect).toHaveBeenCalledWith("s1"));
  });

  it("queues detection from No mappings yet", async () => {
    vi.spyOn(api, "getZMapping").mockResolvedValue({ total: 0, mappings: [] });
    const detect = vi.spyOn(api, "detectZObjectsNow").mockResolvedValue({ queued: true, version_id: "v1" });
    renderWithQuery(<MappingSection systemId="s1" />);
    await screen.findByText("No mappings yet");
    await userEvent.click(within(emptyOf("No mappings yet")).getByRole("button", { name: "Detect now" }));
    await waitFor(() => expect(detect).toHaveBeenCalledWith("s1"));
  });

  it("hides Detect now without the analyse permission", async () => {
    allowed = false;
    vi.spyOn(api, "getZMapping").mockResolvedValue({ total: 0, mappings: [] });
    renderWithQuery(<MappingSection />);
    await screen.findByText("No mappings yet");
    expect(screen.queryByRole("button", { name: "Detect now" })).toBeNull();
  });
});
