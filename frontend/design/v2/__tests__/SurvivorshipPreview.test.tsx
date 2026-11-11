import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { Inspector } from "../Inspector";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "viewer", label: "Viewer", name: "", email: null, fixture: true, can: (a: string) => h.allowed.has(a) }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  setUrl("/o/ecc-production/material-master/golden?fixture=1&open=survivorship:material_master");
});

describe("the survivorship preview", () => {
  it("a reader can preview the rules, and sees the diff with its dictionary check", async () => {
    h.allowed = new Set(["mdm.read"]);
    renderWithQuery(<Inspector />);
    await screen.findByRole("list", { name: "Survivorship rules" });
    expect(screen.queryByRole("button", { name: "Save rules" })).toBeNull();
    fireEvent.click(screen.getByTestId("sv-preview-btn"));
    const out = await screen.findByTestId("sv-preview");
    expect(out.textContent).toContain("3 golden records would change, 6 values in all; 2 new values fail a dictionary check.");
    const attrs = within(out).getByTestId("sv-preview-attrs");
    expect(within(attrs).getByText("T023")).toBeInTheDocument();
    expect(attrs.textContent).toContain("ZZ99");
    expect(within(out).getByTestId("sv-preview-samples").textContent).toContain("SYS_B");
  });

  it("no preview button without mdm.read", async () => {
    h.allowed = new Set();
    renderWithQuery(<Inspector />);
    await screen.findByRole("list", { name: "Survivorship rules" });
    expect(screen.queryByTestId("sv-preview-btn")).toBeNull();
  });
});
