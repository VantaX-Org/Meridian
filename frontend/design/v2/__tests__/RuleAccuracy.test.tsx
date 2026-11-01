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
    const needs = screen.getAllByTestId("needs-permission").map(norm).join(" ");
    expect(needs).toContain("manage systems");
    expect(needs).toContain("manage rules");
    expect(screen.queryByRole("button", { name: "Upload the list" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Draft tuned version" })).toBeNull();
  });

  it("shows the self-tuning proposal with its evidence and diff, and drafts it as a version", async () => {
    const spy = vi.spyOn(pilotApi, "draftTunedVersion");
    renderWithQuery(<RuleAccuracySection />);
    const sec = await screen.findByRole("region", { name: "MM228" });
    const text = norm(sec);
    expect(text).toContain("Source list is mandatory for the material at the plant");
    expect(text).toContain("MARC.WERKS=1000");
    expect(text).toContain("Plant");
    expect(text).toContain("MARA.MTART=DIEN");
    expect(text).toContain("Material type");
    expect(text).toContain("60.0% to 94.7%");
    expect(within(sec).getByLabelText("Changes to MM228")).toHaveTextContent("not_in:");
    expect(within(sec).getByRole("link", { name: "Review the rule's versions" }).getAttribute("href")).toContain("/r/MM228");
    fireEvent.click(within(sec).getByRole("button", { name: "Draft tuned version" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("MM228"));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("Tuned version drafted");
    expect(await within(sec).findByText(/Version 2 is/)).toBeInTheDocument();
    expect(within(sec).getByRole("button", { name: "Draft tuned version" })).toBeDisabled();
  });
});
