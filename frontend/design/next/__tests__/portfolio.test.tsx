import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../kit";
import { Portfolio } from "../screens/Portfolio";
import { ObjectsList } from "../screens/ObjectsList";
import { UploadPanel } from "../panels/UploadPanel";
import { checkFile, pool, MAX_BYTES } from "@/lib/api/next/upload";
import type { PortfolioRow } from "@/lib/api/next/portfolio";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const start = vi.fn(async (ids: string[]) => ({ queued: ids, skipped: [] as string[] }));
vi.mock("@/lib/api/next/portfolio", async (orig) => ({ ...(await orig<typeof import("@/lib/api/next/portfolio")>()), startObjects: (ids: string[]) => start(ids) }));

const upload = vi.fn(async (_f: File, parent?: string) => ({ version_id: `new-${parent}`, job_id: null, status: "pending", parent_version_id: parent ?? "", kind: "template", applied: 1, unchanged: 0, unmatched: 0, unmapped: {}, skipped: {}, no_table: [], no_field: [] }));
vi.mock("@/lib/api/v2/roundtrip", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/roundtrip")>()), uploadCleaned: (f: File, p?: string) => upload(f, p) }));

const marker = vi.fn<(f: File) => Promise<{ version_id?: string; module?: string }>>(async () => ({}));
vi.mock("@/lib/api/next/upload", async (orig) => ({ ...(await orig<typeof import("@/lib/api/next/upload")>()), readMarker: (f: File) => marker(f) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/portfolio?fixture=1");
  start.mockClear();
  upload.mockClear();
  marker.mockReset();
  marker.mockResolvedValue({});
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

const xlsx = (name: string) => new File(["x"], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

describe("Portfolio", () => {
  it("pages 100 objects from the server, 50 at a time", async () => {
    const u = userEvent.setup();
    renderWithQuery(<ToastProvider><Portfolio /></ToastProvider>);
    await waitFor(() => expect(screen.getAllByTestId("pf-card")).toHaveLength(50));
    expect(screen.getByText(/Showing 1–50 of 100/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /^Next/ }));
    expect(await screen.findByText(/Showing 51–100 of 100/)).toBeInTheDocument();
  });

  it("pulls five selected objects after the confirm", async () => {
    const u = userEvent.setup();
    renderWithQuery(<ToastProvider><Portfolio /></ToastProvider>);
    const cards = await waitFor(() => {
      const c = screen.getAllByTestId("pf-card");
      expect(c.length).toBeGreaterThan(5);
      return c;
    });
    const mods = new Set<string>();
    for (const c of cards) {
      const code = within(c).getByText((_, el) => !!el?.classList.contains("nx-pf-code")).textContent ?? "";
      if (mods.has(code)) continue;
      mods.add(code);
      await u.click(within(c).getByRole("checkbox"));
      if (mods.size === 5) break;
    }
    const bar = screen.getByTestId("pf-bulk");
    expect(bar).toHaveTextContent("5 objects selected");
    await u.click(within(bar).getByRole("button", { name: /^Pull now/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Pull 5 objects now?");
    await u.click(within(dialog).getByRole("button", { name: /^Pull now/ }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(new Set(start.mock.calls[0][0])).toEqual(mods);
    expect(await screen.findByText("5 objects queued to pull.")).toBeInTheDocument();
  });
  it("sends Compare runs and the change chips to the next object page's cycle tab, which exists", async () => {
    renderWithQuery(<ToastProvider><Portfolio /></ToastProvider>);
    const card = (await screen.findAllByTestId("pf-card"))[0];
    const hrefs = within(card).getAllByRole("link").map((a) => a.getAttribute("href") ?? "").filter((h) => h.includes("step=compare"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toMatch(/^\/next\/o\/[^/]+\/[^/]+\/cycle\?step=compare&run=/);
  });
});

describe("Objects list", () => {
  it("groups objects under their system", async () => {
    renderWithQuery(<ToastProvider><ObjectsList /></ToastProvider>);
    const groups = await screen.findAllByTestId("ol-system");
    expect(groups.length).toBeGreaterThan(0);
    expect(within(groups[0]).getAllByRole("link").length).toBeGreaterThan(0);
  });
});

describe("Upload panel", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ module: `m${i}`, label: `Object ${i}`, version_id: `run-${i}`, run_number: i + 1 })) as unknown as PortfolioRow[];

  it("uploads five workbooks, each linked to its parent run", async () => {
    marker.mockImplementation(async (f: File) => ({ version_id: `run-${f.name[0]}`, module: `m${f.name[0]}` }));
    const done = vi.fn();
    const u = userEvent.setup();
    const { container } = renderWithQuery(<UploadPanel open expected={rows} onClose={() => {}} onDone={done} />);
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
    await u.upload(input, [0, 1, 2, 3, 4].map((i) => xlsx(`${i}.xlsx`)));
    await waitFor(() => expect(screen.getAllByTestId("upload-row").every((r) => r.dataset.status === "ready")).toBe(true));
    await u.click(screen.getByRole("button", { name: /^Upload all 5/ }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls.map((c) => c[1]).sort()).toEqual(["run-0", "run-1", "run-2", "run-3", "run-4"]);
    expect(done.mock.calls[0][0]).toHaveLength(5);
  });

  it("asks for the run when a file does not name one", async () => {
    const u = userEvent.setup();
    const { container } = renderWithQuery(<UploadPanel open expected={rows.slice(0, 2)} onClose={() => {}} onDone={() => {}} />);
    await u.upload(container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!, xlsx("plain.xlsx"));
    const row = await screen.findByTestId("upload-row");
    expect(row.dataset.status).toBe("needs");
    await u.selectOptions(within(row).getByRole("combobox"), "run-1");
    await u.click(screen.getByRole("button", { name: /^Upload/ }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(File), "run-1"));
  });
});

describe("upload helpers", () => {
  it("checkFile stops wrong types and big files", () => {
    expect(checkFile(xlsx("a.xlsx"))).toBeNull();
    expect(checkFile(new File(["x"], "a.pdf"))).toMatch(/Excel/);
    const big = xlsx("b.xlsx");
    Object.defineProperty(big, "size", { value: MAX_BYTES + 1 });
    expect(checkFile(big)).toMatch(/25 MB/);
  });
  it("pool runs every item, at most size at once", async () => {
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(n);
      live--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });
});
