// The scope bar's record finder: debounced search over failing records in the current run, opened in its object.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let pathname = "/objects";
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

const searchWork = vi.fn();
vi.mock("@/lib/api/work", () => ({ searchWork: (...args: unknown[]) => searchWork(...args) }));

import { GlobalSearch, SEARCH_LIMIT, recordHref } from "../global-search";

const item = (n: number, over: Record<string, unknown> = {}) => ({
  module: "material_master", record_key: `MATNR=M${n}`, name: `Bolt ${n}`, issues: 2, status: "to_fix", severity: "high", ...over,
});

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <input aria-label="Other field" />
      <GlobalSearch />
    </QueryClientProvider>,
  );
}

const input = () => screen.getByRole("combobox", { name: "Find a record by key or name" });

async function typeAndWait(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    push.mockClear();
    searchWork.mockReset();
    pathname = "/objects";
    search = new URLSearchParams();
  });
  afterEach(() => vi.useRealTimers());

  it("debounces and searches the current run", async () => {
    search = new URLSearchParams("run=v1");
    searchWork.mockResolvedValue({ version_id: "v1", items: [item(1)] });
    renderSearch();
    fireEvent.change(input(), { target: { value: "bo" } });
    fireEvent.change(input(), { target: { value: "bol" } });
    expect(searchWork).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(searchWork).toHaveBeenCalledTimes(1);
    expect(searchWork).toHaveBeenCalledWith("bol", "v1");
    expect(await screen.findByRole("option", { name: /Bolt 1/ })).toHaveTextContent("To fix");
  });

  it("does not search under two characters", async () => {
    renderSearch();
    await typeAndWait("b");
    expect(searchWork).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows at most twenty results with object, issue count and status", async () => {
    searchWork.mockResolvedValue({ version_id: "v1", items: Array.from({ length: 25 }, (_, i) => item(i)) });
    renderSearch();
    await typeAndWait("bolt");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(SEARCH_LIMIT);
    expect(options[0]).toHaveTextContent("Material master");
    expect(options[0]).toHaveTextContent("2 issues");
  });

  it("opens the highlighted record on Enter, keeping ?run=", async () => {
    search = new URLSearchParams("run=v9");
    searchWork.mockResolvedValue({ version_id: "v9", items: [item(1), item(2)] });
    renderSearch();
    await typeAndWait("bolt");
    await screen.findAllByRole("option");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/objects/material_master?record=MATNR%3DM2&run=v9");
  });

  it("opens a record on click and falls back to the key when there is no name", async () => {
    searchWork.mockResolvedValue({ version_id: "v1", items: [item(7, { name: null })] });
    renderSearch();
    await typeAndWait("M7");
    fireEvent.click(await screen.findByRole("option", { name: /Material M7/ }));
    expect(push).toHaveBeenCalledWith("/objects/material_master?record=MATNR%3DM7");
  });

  it("says so when nothing matches", async () => {
    searchWork.mockResolvedValue({ version_id: "v1", items: [] });
    renderSearch();
    await typeAndWait("zzz");
    expect(await screen.findByRole("status")).toHaveTextContent("No failing record matches");
  });

  it("closes on Escape", async () => {
    searchWork.mockResolvedValue({ version_id: "v1", items: [item(1)] });
    renderSearch();
    await typeAndWait("bolt");
    await screen.findByRole("listbox");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("focuses on / from the page, but not while typing in another field", () => {
    renderSearch();
    const other = screen.getByRole("textbox", { name: "Other field" });
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(input());
  });

  it("ignores a process-discovery ?run=", async () => {
    pathname = "/process/ptp";
    search = new URLSearchParams("run=discovery-7");
    searchWork.mockResolvedValue({ version_id: "v1", items: [] });
    renderSearch();
    await typeAndWait("bolt");
    expect(searchWork).toHaveBeenCalledWith("bolt", undefined);
  });
});

describe("recordHref", () => {
  it("encodes the module and key and keeps the run", () => {
    expect(recordHref({ module: "business_partner", record_key: "PARTNER=1|BUKRS=10" }, "r1")).toBe("/objects/business_partner?record=PARTNER%3D1%7CBUKRS%3D10&run=r1");
  });
});
