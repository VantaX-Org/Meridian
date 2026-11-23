import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import AletheiaPanel from "@/ui/kit/AletheiaPanel";
import { AletheiaProvider } from "@/ui/kit";
import { ObjectScreen } from "./ObjectScreen";

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };
const screenWithChat = () => (
  <AletheiaProvider>
    <ObjectScreen system="ecc-production" module="material-master" />
    <AletheiaPanel labels={labels} />
  </AletheiaProvider>
);

const dl = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/api/next/runs", async (orig) => ({ ...(await orig<typeof import("@/lib/api/next/runs")>()), downloadCleaningWorkbook: dl.fn }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  dl.fn.mockReset().mockResolvedValue(undefined);
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1");
});
afterEach(() => undo());

describe("ObjectScreen", () => {
  it("shows why the workbook download failed", async () => {
    dl.fn.mockRejectedValue(new Error("That run has not finished."));
    renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Download workbook" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Download workbook" }));
    expect((await screen.findByTestId("download-error")).textContent).toBe("That run has not finished.");
    expect(dl.fn).toHaveBeenCalledTimes(1);
  });

  it("lists every measured rule, passing too, with All, Failing and Passing views", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    const all = await screen.findByRole("tab", { name: /^All/ });
    const count = (el: HTMLElement) => Number(el.textContent?.replace(/\D/g, ""));
    const fail = count(screen.getByRole("tab", { name: /^Failing/ }));
    const pass = count(screen.getByRole("tab", { name: /^Passing/ }));
    expect(count(all)).toBe(fail + pass);
    fireEvent.click(screen.getByRole("tab", { name: /^Passing/ }));
    const table = document.getElementById("all-rules-panel-passing") as HTMLElement;
    if (pass > 0) expect(within(table).getAllByRole("link")[0].getAttribute("href")).toContain("/r/");
  });

  it("turns an old as_of link into run", async () => {
    window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1&as_of=b0500000-0000-4000-8000-000000000005");
    renderWithQuery(screenWithChat());
    const { getUrl } = await import("@/ui/testing/nav-store");
    await waitFor(() => expect(getUrl()).toMatch(/[?&]run=b0500000-0000-4000-8000-000000000005/));
    expect(getUrl()).not.toMatch(/as_of=/);
  });

  it("shows the header, the score ring and the rule list, and a selected rule opens its tabs", async () => {
    renderWithQuery(screenWithChat());
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix records" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Failing rules" });
    const rows = within(list).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Why" }));
    expect(screen.getByRole("link", { name: "Open the rule" }).getAttribute("href")).toContain("/r/");
  });

  it("opens the Aletheia chat and answers a suggested prompt with evidence", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    // the screen can re-mount its header while the run settles, so click until the chat opens
    await waitFor(() => { fireEvent.click(screen.getByRole("button", { name: "Ask Aletheia" })); expect(screen.getByRole("dialog")).toBeTruthy(); });
    // an answer asked while the run is still settling says so, so ask again until the rule data is in
    await waitFor(() => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Which rule hurts this object most?" }));
      expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Review fixes" })).toBeTruthy();
    });
  });

  it("lists the run number and the record count as separate meta items", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    const h = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => {
      const items = Array.from(h.closest("header")?.querySelectorAll(".mx-head-meta li") ?? []).map((x) => x.textContent ?? "");
      expect(items.some((x) => /^Run \S+/.test(x))).toBe(true);
      expect(items.some((x) => /^\S+ records checked against \d+ rules/.test(x))).toBe(true);
    });
  });

  it("on a stacked layout a selected rule opens its detail in a bottom sheet, not in the page", async () => {
    const mm = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal("matchMedia", mm);
    window.matchMedia = mm as unknown as typeof window.matchMedia;
    try {
      renderWithQuery(screenWithChat());
      const list = await screen.findByRole("list", { name: "Failing rules" });
      expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull();
      fireEvent.click(within(list).getAllByRole("button")[0]);
      const dialog = await screen.findByRole("dialog", { name: "Selected rule" });
      expect(within(dialog).getByRole("tab", { name: "Overview" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      // @ts-expect-error jsdom has no matchMedia by default
      delete window.matchMedia;
    }
  });

  it("explains how the score is made", async () => {
    renderWithQuery(screenWithChat());
    const receipt = await screen.findByTestId("score-receipt");
    expect(receipt.querySelector("summary")?.textContent ?? "").toMatch(/^How [\d.]+ is made$/);
    expect(within(receipt).getByText("Records checked")).toBeTruthy();
  });

  it("on an older run the actions are gated and point to the current run", async () => {
    window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1&run=b0500000-0000-4000-8000-000000000005");
    renderWithQuery(screenWithChat());
    const old = await screen.findByTestId("old-run");
    expect(within(old).getByRole("link", { name: "Open the current run to act" }).getAttribute("href")).toMatch(/[?&]run=(?!b0500000)/);
    expect(screen.queryByRole("link", { name: "Fix records" })).toBeNull();
  });

  it("draws the score on the ruler, with no ring, and every sub-screen reachable from the strip", async () => {
    const { container } = renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    expect(await screen.findByRole("img", { name: "Score of this object against the gates" })).toBeTruthy();
    expect(container.querySelector("[data-mark='object']")).toBeTruthy();
    expect(container.querySelector(".mx-ring")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Object screens" });
    const links = within(nav).getAllByRole("link");
    expect(links.length).toBe(12);
    expect(within(nav).getByRole("link", { name: "Processes" }).getAttribute("href")).toContain("/processes");
    expect(within(nav).getByText("More")).toBeTruthy();
  });

  it("opens the Aletheia sheet scoped to this object and draws a chart", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    await waitFor(() => { fireEvent.click(screen.getByRole("button", { name: "Ask Aletheia" })); expect(screen.getByRole("dialog")).toBeTruthy(); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(/^Asking about /).length).toBeGreaterThan(0);
    await waitFor(() => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Which rule hurts this object most?" }));
      expect(screen.getByRole("dialog").querySelector(".mx-ans-chart")).toBeTruthy();
    });
  });

  it("builds the board: hero, zoned ruler, three cards, worst rules table", async () => {
    renderWithQuery(screenWithChat());
    const hero = await screen.findByTestId("score-hero");
    expect(hero.textContent).toMatch(/Measured/);
    expect(await screen.findByText("Six dimensions")).toBeTruthy();
    expect(screen.getByText("Holding the cap")).toBeTruthy();
    expect(screen.getByText("Score by run")).toBeTruthy();
    expect(screen.getAllByTestId("tonebar").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /^All \d+ rules$/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Records affected/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /critical/i }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("monitor-strip")).toBeTruthy();
  });
});
