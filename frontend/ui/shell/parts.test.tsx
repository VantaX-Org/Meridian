import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setShareMode, setViewAs } from "@/lib/v2/view-as";
import { Banners, FailedJobLine, HealthWord, InboxButton, usePaletteSearch, ViewAsSheet } from "./parts";

vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const at = (p: string) => window.history.replaceState(null, "", `${p}${p.includes("?") ? "&" : "?"}fixture=1`);

beforeEach(() => { window.sessionStorage.clear(); at("/"); });
afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });

function Search({ q }: { q: string }) {
  const rows = usePaletteSearch(q);
  return <ul>{rows.map((r) => <li key={r.id} data-testid="hit">{r.label}: {r.hint}</li>)}</ul>;
}

describe("shell banners", () => {
  it("says the user is offline first", () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderWithQuery(<Banners />);
    expect(screen.getByTestId("offline-banner").textContent).toMatch(/You are offline/);
  });
  it("names the role being viewed as, with a way to stop", async () => {
    act(() => setViewAs("auditor"));
    renderWithQuery(<Banners />);
    const band = await screen.findByTestId("view-as-banner");
    expect(band.textContent).toMatch(/Viewing as/);
    expect(screen.getByRole("button", { name: "Stop viewing as" })).toBeTruthy();
  });
  it("shows the shared view with a way out that clears it", async () => {
    act(() => setShareMode("Board pack"));
    renderWithQuery(<Banners />);
    expect(await screen.findByTestId("shared-banner")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Leave the shared view" }));
    expect(screen.queryByTestId("shared-banner")).toBeNull();
  });
  it("shows nothing for a normal session", () => {
    const { container } = renderWithQuery(<Banners />);
    expect(container.querySelector(".mx-banner")).toBeNull();
  });
});

describe("view as a role", () => {
  it("offers every built-in role by name", () => {
    renderWithQuery(<ViewAsSheet open onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "View as a role" })).toBeTruthy();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(3);
    expect(screen.getByRole("button", { name: "View as this role" })).toBeTruthy();
  });
});

describe("top bar parts in fixture mode", () => {
  it("shows the health word, linked to the status page", async () => {
    renderWithQuery(<HealthWord />);
    const link = await screen.findByTestId("status-health");
    expect(link.getAttribute("href")).toBe("/status");
    expect(link.textContent?.length).toBeGreaterThan(0);
  });
  it("shows the unread count and opens the inbox", async () => {
    renderWithQuery(<InboxButton />);
    const link = screen.getByTestId("inbox");
    expect(link.getAttribute("href")).toMatch(/^\/me\/notifications/);
    await vi.waitFor(() => expect(link.textContent).toMatch(/Inbox \d/));
  });
  it("renders the failed-job line only when a failure is open", async () => {
    const { container } = renderWithQuery(<FailedJobLine />);
    await new Promise((r) => setTimeout(r, 50));
    const line = container.querySelector("[data-testid=status-failure]");
    if (line) expect(line.querySelector("a")?.getAttribute("href")).toMatch(/^\/runs\?view=jobs/);
    else expect(container.textContent).toBe("");
  });
});

describe("failed-job line", () => {
  it("names the system and time, and a dismiss hides it", async () => {
    const jobs = [{ id: "j1", kind: "extraction", status: "failed", label: "Extraction | Material master", modules: ["material_master"], error: "RFC_LOGON_FAILURE. Check the user.", started_at: 1700000000, finished_at: 1700000100, system_id: "sys1" }];
    const rq = await import("@/lib/v2/runs-queries");
    vi.spyOn(rq, "useV2Jobs").mockReturnValue({ jobs } as unknown as ReturnType<typeof rq.useV2Jobs>);
    vi.spyOn(rq, "useSystemsExtended").mockReturnValue({ data: [{ id: "sys1", name: "Sanbox (KMZ)" }] } as unknown as ReturnType<typeof rq.useSystemsExtended>);
    const { container } = renderWithQuery(<FailedJobLine />);
    expect(container.textContent).toContain("Sanbox (KMZ)");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(container.querySelector("[data-testid=status-failure]")).toBeNull();
  });
});

describe("palette server search", () => {
  it("returns nothing for empty text", () => {
    renderWithQuery(<Search q="" />);
    expect(screen.queryAllByTestId("hit")).toHaveLength(0);
  });
  it("lists GET /command hits for typed text", async () => {
    renderWithQuery(<Search q="MAT" />);
    expect((await screen.findAllByTestId("hit", {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  });
});
