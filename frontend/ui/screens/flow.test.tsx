import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { Load } from "./load/Load";
import { Plan } from "./load/Plan";
import { Templates } from "./load/Templates";
import { Approvals } from "./work/Approvals";
import { Work } from "./work/Work";
import { MonitorBoard } from "./insights/MonitorBoard";
import { Rules } from "./rules/Rules";
import { DryRun } from "./rules/DryRun";
import { Match } from "./mdm/Match";
import { AdminBoard } from "./admin/AdminBoard";
import { SubjectRequests } from "./admin/ops/SubjectRequests";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const wrap = (el: React.ReactNode) => renderWithQuery(<AletheiaProvider><ToastHost>{el}</ToastHost></AletheiaProvider>);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/?fixture=1"); });
afterEach(() => undo());

describe("breadcrumbs and steppers", () => {
  it.each([
    ["Load", () => <Load />, "Load journey"],
    ["Plan", () => <Plan />, "Load journey"],
    ["Approvals", () => <Approvals />, "Approval"],
    ["Templates", () => <Templates />, "Workbook fill"],
    ["DryRun", () => <DryRun />, "Rule change"],
    ["Match", () => <Match />, "Master data journey"],
    ["SubjectRequests", () => <SubjectRequests />, "Subject request"],
  ])("%s shows crumbs and its stepper", async (_n, el, stepper) => {
    wrap(el());
    expect(await screen.findByRole("navigation", { name: /breadcrumb/i }, { timeout: 5000 })).toBeTruthy();
    expect((await screen.findAllByLabelText(new RegExp(stepper), undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
});

describe("Work fix sheet import", () => {
  it("opens the shared import sheet instead of a bare file input", async () => {
    window.history.replaceState(null, "", "/work?fixture=1");
    wrap(<Work />);
    const btn = await screen.findByRole("button", { name: "Import workbook" }, { timeout: 5000 });
    fireEvent.click(btn);
    expect(await screen.findByText("Drop the fix sheet you filled in.")).toBeTruthy();
  });
});

describe("Monitor rows", () => {
  it("show a status badge and the last breach time with its zone", async () => {
    window.history.replaceState(null, "", "/monitor?fixture=1");
    wrap(<MonitorBoard />);
    const rows = await screen.findAllByTestId("monitor-break", undefined, { timeout: 5000 });
    await waitFor(() => expect(rows[0].textContent).toMatch(/Last breach .*(GMT|UTC|[A-Z]{2,5})/));
    expect(rows[0].querySelector(".mx-badge")).toBeTruthy();
  });
});

describe("Admin setup", () => {
  it("shows the setup stepper on the board", async () => {
    wrap(<AdminBoard />);
    expect((await screen.findAllByLabelText("Admin setup", undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
});

describe("Rules import", () => {
  it("opens the shared import sheet instead of a bare file input", async () => {
    window.history.replaceState(null, "", "/rules?fixture=1");
    wrap(<Rules />);
    fireEvent.click(await screen.findByRole("button", { name: "Import rules" }, { timeout: 5000 }));
    expect(await screen.findByText("Drop a YAML file or an Excel workbook of rules.")).toBeTruthy();
  });
});
