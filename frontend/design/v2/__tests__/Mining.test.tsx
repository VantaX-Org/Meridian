import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import { resetObjectFixture } from "@/lib/api/v2/fixtures/object";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { RulesTab } from "../screens/object/RulesTab";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let granted: string[] | "all" = "all";
vi.mock("@/lib/v2/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2/hooks")>();
  return { ...actual, useV2Session: () => ({ persona: "lead" as const, label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => granted === "all" || granted.includes(a) }) };
});

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  granted = "all";
  resetObjectFixture();
  resetWorkFixture();
  setUrl("/v2/o/ecc-production/material-master?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const render = () => renderWithQuery(<RulesTab system="ecc-production" module="material-master" />);
const learned = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Learned 4" }));
  return screen.findByRole("table", { name: "Learned rules waiting for a decision" });
};

describe("rules mined from stewards' fixes", () => {
  it("show their evidence: the fixes they came from, the count, who and when, and the value", async () => {
    render();
    const t = await learned();
    const meins = within(t).getAllByRole("row").find((r) => norm(r).includes("MARA.MEINS"))!;
    expect(norm(meins)).toContain("Blank field stewards always fill");
    expect(norm(meins)).toContain("From fixes: 30 records, 12 Oct 2026 to 16 Oct 2026, by a.naidoo@example.com");
    expect(norm(meins)).toContain("Blank, filled with EA");
    expect(norm(meins)).toContain("and 25 more");
    expect(within(meins).getByRole("link", { name: "000000000000000100" })).toHaveAttribute("href", expect.stringContaining("open=record%3Amaterial_master%3AMATNR%3D000000000000000100"));
    const gewei = within(t).getAllByRole("row").find((r) => norm(r).includes("MARA.GEWEI"))!;
    expect(norm(gewei)).toContain("Was K.G, corrected to KG");
    const dismm = within(t).getAllByRole("row").find((r) => norm(r).includes("MARC.DISMM"))!;
    expect(norm(dismm)).toContain("From the data: 48,212 rows agree");
  });

  it("an approver accepts one with a severity; it is never enabled without that decision", async () => {
    const approve = vi.spyOn(objectApi, "approveLearned");
    render();
    const t = await learned();
    const meins = within(t).getAllByRole("row").find((r) => norm(r).includes("MARA.MEINS"))!;
    fireEvent.change(within(meins).getByRole("combobox", { name: "Severity for MARA.MEINS" }), { target: { value: "critical" } });
    fireEvent.click(within(meins).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("lp-003", "critical"));
    expect(await screen.findByText(/It runs from the next analysis/)).toBeInTheDocument();
  });

  it("a rule manager may mine the fixes now and dismiss; a viewer only reads", async () => {
    granted = ["view", "manage_rules"];
    const { unmount } = render();
    await learned();
    fireEvent.click(screen.getByRole("button", { name: /Mine stewards.* fixes now/ }));
    expect(await screen.findByText(/0 new, 2 refreshed, from 56 fixes; a rule needs 25 records fixed the same way\./)).toBeInTheDocument();
    unmount();
    granted = ["view"];
    render();
    const t = await learned();
    expect(screen.queryByRole("button", { name: /Mine stewards/ })).toBeNull();
    expect(within(t).queryByRole("button", { name: "Reject" })).toBeNull();
  });
});
