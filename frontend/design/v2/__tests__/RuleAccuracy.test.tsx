import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as pilotApi from "@/lib/api/v2/pilot";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { RuleAccuracySection } from "../admin/accuracy";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetRunsFixture();
  resetKeptOutcomes();
  undo = stubLayout();
  h.allowed = "all";
  setUrl("/admin/ruleaccuracy?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("Admin: rule accuracy", () => {
  it("lists each rule with its description, the rule needing tuning first, and a dash where too few were reviewed", async () => {
    renderWithQuery(<RuleAccuracySection />);
    const table = await screen.findByRole("table", { name: "Accuracy by rule" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(norm(rows[0])).toContain("Material has no base unit of measure");
    expect(norm(rows[0])).toContain("MM142");
    expect(norm(rows[0])).toContain("55.0%");
    expect(norm(rows[0])).toContain("Needs tuning");
    const last = norm(rows[rows.length - 1]);
    expect(last).toContain("BP207");
    expect(last).toContain("Not enough reviews");
    expect(last).toContain("—");
  });

  it("uploads the known bad records and then shows how many were caught", async () => {
    const spy = vi.spyOn(pilotApi, "uploadKnownIssues");
    renderWithQuery(<RuleAccuracySection />);
    await screen.findByRole("table", { name: "Accuracy by rule" });
    expect(await screen.findByText(/^No known bad records yet/)).toBeInTheDocument();
    const csv = "object,record,note\nmaterial_master,MARA|100234,Wrong unit\nmaterial_master,MARA|100235,\nbusiness_partner,BUT000|9";
    fireEvent.change(screen.getByLabelText(/^CSV/), { target: { value: csv } });
    fireEvent.click(screen.getByRole("button", { name: "Upload the list" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("a1b2c3d4-0001-4000-8000-000000000001", csv));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Known bad records loaded");
    expect(await screen.findByRole("table", { name: "Records no rule flagged" })).toBeInTheDocument();
    expect(screen.getByText("Caught share")).toBeInTheDocument();
  });

  it("uploading needs the manage systems permission", async () => {
    h.allowed = ["view"];
    renderWithQuery(<RuleAccuracySection />);
    await screen.findByRole("table", { name: "Accuracy by rule" });
    expect(screen.getByTestId("needs-permission")).toHaveTextContent("manage systems");
    expect(screen.queryByRole("button", { name: "Upload the list" })).toBeNull();
  });
});
