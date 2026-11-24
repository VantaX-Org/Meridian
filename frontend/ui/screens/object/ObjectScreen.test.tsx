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
  const ready = async () => { await screen.findByTestId("score-hero"); await screen.findByRole("group", { name: "Every measured rule" }); };
  const rowCount = () => within(screen.getByRole("group", { name: "Every measured rule" })).getAllByRole("row").length - 1;
  const url = async () => (await import("@/ui/testing/nav-store")).getUrl();

  it("shows why the workbook download failed", async () => {
    dl.fn.mockRejectedValue(new Error("That run has not finished."));
    renderWithQuery(screenWithChat());
    await ready();
    await waitFor(() => expect((screen.getByRole("button", { name: "Download workbook" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Download workbook" }));
    expect((await screen.findByTestId("download-error")).textContent).toBe("That run has not finished.");
  });

  it("turns an old as_of link into run", async () => {
    window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1&as_of=b0500000-0000-4000-8000-000000000005");
    renderWithQuery(screenWithChat());
    await waitFor(async () => expect(await url()).toMatch(/[?&]run=b0500000-0000-4000-8000-000000000005/));
    expect(await url()).not.toMatch(/as_of=/);
  });

  it("builds the four regions: hero, key figures, three charts, one rule grid", async () => {
    const { container } = renderWithQuery(screenWithChat());
    await ready();
    expect(screen.getByTestId("score-hero").textContent).toMatch(/Measured/);
    expect(screen.getByRole("img", { name: "Score of this object against the gates" })).toBeTruthy();
    expect(container.querySelector("[data-mark='object']")).toBeTruthy();
    expect(screen.getByText("Score by run")).toBeTruthy();
    expect(screen.getByText("Dimensions")).toBeTruthy();
    expect(screen.getByText("Failing records by severity")).toBeTruthy();
    expect(screen.getAllByRole("group", { name: "Every measured rule" }).length).toBe(1);
    expect(screen.getByRole("navigation", { name: "Object screens" })).toBeTruthy();
    expect(screen.getByTestId("monitor-strip")).toBeTruthy();
    expect(screen.getByTestId("score-receipt")).toBeTruthy();
  });

  it("a key figure filters the grid through the URL and the active chip removes it", async () => {
    renderWithQuery(screenWithChat());
    await ready();
    const all = rowCount();
    fireEvent.click(screen.getAllByRole("button", { name: /^Failing records/ })[0]);
    await waitFor(async () => expect(await url()).toMatch(/rules\.f\.state=failing/));
    await waitFor(() => expect(rowCount()).toBeLessThanOrEqual(all));
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Failing" }));
    await waitFor(async () => expect(await url()).not.toMatch(/rules\.f\.state/));
    await waitFor(() => expect(rowCount()).toBe(all));
  });

  it("a severity tile filters and group by severity writes the URL", async () => {
    renderWithQuery(screenWithChat());
    await ready();
    const sev = screen.getAllByRole("button").find((b) => /critical/i.test(b.textContent ?? "") && b.closest(".mx-card"));
    expect(sev).toBeTruthy();
    fireEvent.click(sev as HTMLElement);
    await waitFor(async () => expect(await url()).toMatch(/rules\.f\.severity=critical/));
    fireEvent.change(screen.getByRole("combobox", { name: /Group by/i }), { target: { value: "severity" } });
    await waitFor(async () => expect(await url()).toMatch(/rules\.group=severity/));
  });

  it("the cap sentence names the capping rules and opens one in the side panel", async () => {
    renderWithQuery(screenWithChat());
    await ready();
    const cap = await screen.findByTestId("cap-list");
    const first = within(cap).getAllByRole("button")[0];
    fireEvent.click(first);
    await waitFor(async () => expect(await url()).toMatch(/rules\.open=/));
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(async () => expect(await url()).not.toMatch(/rules\.open=/));
  });

  it("opens the panel from the URL and keeps it on reload", async () => {
    window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1&rules.f.state=failing");
    const first = renderWithQuery(screenWithChat());
    await ready();
    fireEvent.click(within(screen.getByRole("group", { name: "Every measured rule" })).getAllByRole("row")[1]);
    await screen.findByRole("tab", { name: "Overview" });
    const saved = await url();
    expect(saved).toMatch(/rules\.open=/);
    first.unmount();
    window.history.replaceState(null, "", saved);
    renderWithQuery(screenWithChat());
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(await url()).toContain("rules.f.state=failing");
  });

  it("gates the actions on an older run and points to the current one", async () => {
    window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1&run=b0500000-0000-4000-8000-000000000005");
    renderWithQuery(screenWithChat());
    const old = await screen.findByTestId("old-run");
    expect(within(old).getByRole("link", { name: "Open the current run to act" }).getAttribute("href")).toMatch(/[?&]run=(?!b0500000)/);
    expect(screen.queryByRole("link", { name: "Fix records" })).toBeNull();
  });

  it("opens the Aletheia chat scoped to this object and answers with evidence", async () => {
    renderWithQuery(screenWithChat());
    await ready();
    await waitFor(() => { fireEvent.click(screen.getByRole("button", { name: "Ask Aletheia" })); expect(screen.getByRole("dialog")).toBeTruthy(); });
    expect(within(screen.getByRole("dialog")).getAllByText(/^Asking about /).length).toBeGreaterThan(0);
    await waitFor(() => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Which rule hurts this object most?" }));
      expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Review fixes" })).toBeTruthy();
    });
  });

  it("shows a skeleton while loading", async () => {
    renderWithQuery(screenWithChat());
    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
    await ready();
  });
});
