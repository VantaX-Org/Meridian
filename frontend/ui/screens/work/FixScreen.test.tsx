import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost, ToastHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { Work } from "./Work";
import { loadCatalogue, setLang } from "@/lib/v2/i18n";
import { decisionSentence } from "./fix/fixlib";

const m = vi.hoisted(() => ({ postDecide: vi.fn(), getWork: vi.fn(), simulateFix: vi.fn(), real: {} as Record<string, (...a: never[]) => unknown> }));
vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/api/v2/work", async (orig) => {
  const a = await orig<typeof import("@/lib/api/v2/work")>();
  m.real.postDecide = a.postDecide as never;
  m.real.getWork = a.getWork as never;
  return { ...a, postDecide: m.postDecide, getWork: m.getWork };
});
vi.mock("@/lib/api/v2/step9", async (orig) => {
  const a = await orig<typeof import("@/lib/api/v2/step9")>();
  m.real.simulateFix = a.simulateFix as never;
  return { ...a, simulateFix: m.simulateFix };
});

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); m.postDecide.mockImplementation((...a: never[]) => m.real.postDecide(...a)); m.getWork.mockImplementation((...a: never[]) => m.real.getWork(...a)); m.simulateFix.mockImplementation((...a: never[]) => m.real.simulateFix(...a)); });
afterEach(() => { undo(); setLang("en"); });

const mount = (url: string) => {
  window.history.replaceState(null, "", url);
  return renderWithQuery(<AletheiaProvider><ToastHost><SheetHost sheets={SHEETS} closeLabel="Close"><Work /></SheetHost></ToastHost></AletheiaProvider>);
};
const count = () => Number(/^(\d+)/.exec(screen.getByTestId("decision-sentence").textContent ?? "")?.[1]);
const grid = async () => within(await screen.findByTestId("fix-grid", {}, { timeout: 5000 }));

describe("the fix screen", () => {
  it("renders the strip, the rule rail and the grid from the fixture", async () => {
    mount("/work?fixture=1");
    expect(await screen.findByTestId("fix-strip", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByTestId("rule-rail")).toBeTruthy();
    expect(((await grid()).getAllByRole("row")).length).toBeGreaterThan(1);
    expect(screen.getByTestId("decision-sentence").textContent).toMatch(/^\d+ draft decisions? in \d+ rules?/);
  });

  it("keeps the old tabs as filter chips", async () => {
    mount("/work?fixture=1");
    const chips = await screen.findByRole("group", { name: "Work status" }, { timeout: 5000 });
    expect(within(chips).getAllByRole("button").length).toBeGreaterThanOrEqual(5);
  });

  it("accepts with A before the server answers and undoes from the toast", async () => {
    let release: (v: unknown) => void = () => undefined;
    m.postDecide.mockImplementation(() => new Promise((r) => { release = r; }));
    mount("/work?fixture=1&filter=proposed");
    const g = await grid();
    const row = (await g.findAllByRole("row", {}, { timeout: 5000 }))[1];
    await screen.findByTestId("decision-sentence");
    const before = count();
    fireEvent.click(row);
    fireEvent.keyDown(screen.getByTestId("fix-grid"), { key: "a" });
    await waitFor(() => expect(count()).toBe(before + 1));
    expect(m.postDecide).toHaveBeenCalledTimes(1);
    release({ updated: 1, draft_batch_id: "b-1", action_id: "act-1" });
  });

  it("rolls a failed decision back and says so", async () => {
    m.postDecide.mockRejectedValue(new Error("boom"));
    mount("/work?fixture=1&filter=proposed");
    const g = await grid();
    const row = (await g.findAllByRole("row", {}, { timeout: 5000 }))[1];
    await screen.findByTestId("decision-sentence");
    const before = count();
    fireEvent.click(row);
    fireEvent.keyDown(screen.getByTestId("fix-grid"), { key: "a" });
    await waitFor(() => expect(count()).toBe(before), { timeout: 5000 });
    expect(await screen.findByText("That did not save. Your change was put back.", {}, { timeout: 5000 })).toBeTruthy();
  });

  it("opens the apply-all preview with Shift+A and the load file dialog from the strip", async () => {
    mount("/work?fixture=1&filter=proposed");
    await grid();
    await screen.findAllByRole("row", {}, { timeout: 5000 });
    fireEvent.keyDown(screen.getByTestId("fix-grid"), { key: "A", shiftKey: true });
    expect(await screen.findByTestId("apply-preview", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByTestId("create-load-file"));
    expect(await screen.findByTestId("load-dialog")).toBeTruthy();
  });

  it("reads several rule ids from the URL", async () => {
    mount("/work?fixture=1&module=material_master&rule=MM142,MM143");
    expect(await screen.findByTestId("fix-grid", {}, { timeout: 5000 })).toBeTruthy();
  });

  const firstRow = async () => {
    const g = await grid();
    const row = (await g.findAllByRole("row", {}, { timeout: 5000 }))[1];
    await screen.findByTestId("decision-sentence");
    return row;
  };

  it("puts the row and the strip sentence back when Undo is pressed", async () => {
    mount("/work?fixture=1&filter=proposed");
    const row = await firstRow();
    const before = count();
    const sentence = screen.getByTestId("decision-sentence").textContent;
    fireEvent.click(row);
    fireEvent.keyDown(screen.getByTestId("fix-grid"), { key: "a" });
    await waitFor(() => expect(count()).toBe(before + 1));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }, { timeout: 5000 }));
    await waitFor(() => expect(count()).toBe(before), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId("decision-sentence").textContent).toBe(sentence));
  });

  it("sends the drafted record keys to the projection", async () => {
    mount("/work?fixture=1");
    await firstRow();
    await waitFor(() => expect(m.simulateFix).toHaveBeenCalled(), { timeout: 5000 });
    const body = m.simulateFix.mock.calls.at(-1)?.[0] as { records: { record_key: string }[] };
    expect(body.records.length).toBeGreaterThan(0);
    expect(body.records.every((r) => typeof r.record_key === "string" && r.record_key.length > 0)).toBe(true);
  });

  it("writes the strip sentence in German and Japanese", async () => {
    await loadCatalogue("de"); await loadCatalogue("ja");
    setLang("de");
    expect(decisionSentence(1, 1)).toBe("1 Entwurfsentscheidung in 1 Regel");
    expect(decisionSentence(15, 5)).toBe("15 Entwurfsentscheidungen in 5 Regeln");
    setLang("ja");
    expect(decisionSentence(15, 5)).toBe("5件のルールに15件の下書き判断");
  });

  it("selects every row and accepts them from the bulk bar", async () => {
    m.postDecide.mockResolvedValue({ updated: 99, draft_batch_id: "b-2", action_id: "act-2" });
    mount("/work?fixture=1&filter=proposed");
    await firstRow();
    const before = count();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(m.postDecide).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const items = (m.postDecide.mock.calls[0] as [unknown[]])[0];
    expect(items.length).toBeGreaterThan(1);
    await waitFor(() => expect(count()).toBeGreaterThanOrEqual(before));
  });

  it("edits a value in place and sends it as an edit", async () => {
    mount("/work?fixture=1&filter=proposed");
    const row = await firstRow();
    fireEvent.click(row);
    fireEvent.keyDown(await screen.findByTestId("fix-grid"), { key: "e" });
    const input = await screen.findByRole("textbox", { name: "New value" }, { timeout: 5000 });
    fireEvent.change(input, { target: { value: "ZZ99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(m.postDecide).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const item = (m.postDecide.mock.calls[0] as [{ action: string; value?: string }[]])[0][0];
    expect(item.action).toBe("edit");
    expect(item.value).toBe("ZZ99");
  });

  it("shows a loading state while the records load", async () => {
    m.getWork.mockImplementation(() => new Promise(() => undefined));
    mount("/work?fixture=1");
    expect(await screen.findByRole("status", { name: "Loading the records" }, { timeout: 5000 })).toBeTruthy();
  });

  it("shows an error state with a retry when the records fail", async () => {
    m.getWork.mockRejectedValue(new Error("down"));
    mount("/work?fixture=1");
    expect(await screen.findByText("The records could not be loaded", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows an empty state when no record matches", async () => {
    m.getWork.mockResolvedValue({ items: [], next_cursor: null, total: 0 });
    mount("/work?fixture=1");
    expect(await screen.findByText("No record matches", {}, { timeout: 5000 })).toBeTruthy();
  });
});
