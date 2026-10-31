import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { parseFields, RequestsCanvas } from "../screens/Requests";
import { WorkflowsSection } from "../admin/workflows";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, shared: false, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Requests", () => {
  it("reads one TABLE.FIELD=value per line and skips the rest", () => {
    expect(parseFields("MARA.MATKL=001\n\nnoise\n MARA.MEINS = EA \n=x")).toEqual({ "MARA.MATKL": "001", "MARA.MEINS": "EA" });
  });

  it("lists the fixture change requests with links that open the request inspector", async () => {
    setUrl("/requests?fixture=1&view=all");
    renderWithQuery(<RequestsCanvas />);
    const table = await screen.findByTestId("requests-table");
    const link = table.querySelector("a");
    expect(link?.getAttribute("href")).toContain("open=request");
  });

  it("gates the workflow administration on manage_workflows", async () => {
    h.allowed = [];
    setUrl("/admin/workflows?fixture=1");
    renderWithQuery(<WorkflowsSection />);
    expect(screen.getByTestId("needs-permission").textContent).toContain("manage workflows");
  });

  it("lists the workflow versions in fixture mode", async () => {
    setUrl("/admin/workflows?fixture=1");
    renderWithQuery(<WorkflowsSection />);
    await waitFor(() => expect(document.querySelector("[data-testid^='workflow-']")).not.toBeNull());
  });
});
