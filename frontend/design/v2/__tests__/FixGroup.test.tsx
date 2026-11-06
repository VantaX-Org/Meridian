import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetExceptionsFixture } from "@/lib/api/v2/fixtures/exceptions";
import { resetFixDrafts } from "@/lib/api/v2/fixtures/fixDrafts";
import { resetActions } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { Attention } from "../screens/Attention";
import { Cleansing } from "../screens/Cleansing";
import { Exceptions } from "../screens/Exceptions";
import { FixDrafts } from "../screens/FixDrafts";
import { PeopleCanvas } from "../screens/People";
import { RequestsCanvas } from "../screens/Requests";
import { WorkAnalytics } from "../screens/WorkAnalytics";
import { WorkMonitor } from "../screens/WorkMonitor";
import { WorkCanvas } from "../screens/Work";
import { Means, FixHead, RunById } from "../FixParts";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetWorkFixture();
  resetExceptionsFixture();
  resetFixDrafts();
  resetActions();
  clearPatches();
  undo = stubLayout(1400, 700);
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
});

const visit = (url: string) => { window.history.pushState({}, "", url); setUrl(url); };

/** Each Fix screen tells a new user what it shows and what its figures mean. */
async function expectLedeAndMeans(re: RegExp) {
  const lede = await screen.findByTestId("lede");
  expect(lede.textContent).toMatch(re);
  const means = screen.getByTestId("means");
  expect(within(means).getAllByRole("term").length).toBeGreaterThan(0);
  expect(within(means).getAllByRole("definition").every((d) => (d.textContent ?? "").length > 10)).toBe(true);
}

describe("Fix group: every screen explains itself", () => {
  const cases: [string, string, () => React.ReactElement, RegExp][] = [
    ["Attention", "/attention", () => <Attention />, /most urgent first/],
    ["Cleansing", "/cleansing", () => <Cleansing />, /Cleansing proposes changes/],
    ["Exceptions", "/work/exceptions?fixture=1", () => <Exceptions />, /carry no run/],
    ["FixDrafts", "/fix-drafts", () => <ToastProvider><FixDrafts /></ToastProvider>, /drafts a fix/],
    ["People", "/people?fixture=1&persona=steward", () => <ToastProvider><PeopleCanvas /></ToastProvider>, /carry no run/],
    ["Requests", "/requests?fixture=1", () => <RequestsCanvas />, /not to a scoring run/],
    ["WorkAnalytics", "/work/analytics", () => <WorkAnalytics />, /how fast the work list/],
    ["WorkMonitor", "/work/monitor", () => <WorkMonitor />, /next run checks the same records/],
    ["Work", "/work?fixture=1&persona=steward", () => <ToastProvider><WorkCanvas /></ToastProvider>, /each object at its newest run/],
  ];
  it.each(cases)("%s shows a lede and a closed what-the-figures-mean list", async (_n, url, el, re) => {
    visit(url);
    renderWithQuery(el());
    await expectLedeAndMeans(re);
  });
});

describe("Work: Current-only gating", () => {
  it("offers the run picker and turns exports off on a past run, with the reason", async () => {
    visit("/work?fixture=1&persona=steward");
    renderWithQuery(<ToastProvider><WorkCanvas /></ToastProvider>);
    const sel = (await screen.findByTestId("as-of-run")) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    fireEvent.change(sel, { target: { value: sel.options[1].value } });
    await waitFor(() => expect(screen.getAllByText(/Actions are off here; go back to today to act\./).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: /Export fix sheet/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps exports on for today", async () => {
    visit("/work?fixture=1&persona=steward");
    renderWithQuery(<ToastProvider><WorkCanvas /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect(await screen.findByRole("menuitem", { name: /Export fix sheet/ })).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("Fix group: rows carry the object and run", () => {
  it("Attention rows name the object with a run chip or a dash with the reason", async () => {
    visit("/attention");
    renderWithQuery(<Attention />);
    const table = await screen.findByTestId("attention-table");
    await waitFor(() => expect(table.querySelectorAll(".m2-objrun").length).toBeGreaterThan(0));
    for (const cell of Array.from(table.querySelectorAll(".m2-objrun"))) {
      // A chip, or a dash that carries its reason as a title; never a bare gap.
      expect(cell.querySelector("[title], [data-run], a, button")).not.toBeNull();
    }
  });
});

describe("Fix parts", () => {
  it("Means lists each term with its meaning", () => {
    renderWithQuery(<Means items={[["SLA", "The promised time."], ["Score", "Out of 100."]]} />);
    expect(screen.getAllByRole("term").map((n) => n.textContent)).toEqual(["SLA", "Score"]);
    expect(screen.getByText("Out of 100.")).toBeInTheDocument();
  });
  it("FixHead renders the lede above the means", () => {
    renderWithQuery(<FixHead lede="What this shows." means={[["A", "Meaning of a long enough sentence."]]} />);
    expect(screen.getByTestId("lede")).toHaveTextContent("What this shows.");
  });
  it("RunById gives a dash with a reason when the id is unknown", async () => {
    const { container } = renderWithQuery(<RunById id="nope" systemId={null} />);
    await waitFor(() => expect(container.querySelector(".m2-dash")).toHaveAttribute("title", "This run is not in the recent list."));
  });
});
