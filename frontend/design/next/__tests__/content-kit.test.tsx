import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckList, Composer, FeedCard, LargeTitle, ObjectSegments, StepFlow, ToastProvider, Toolbar, type CheckResult, type RunOption } from "../kit";

const CHECKS = [
  { code: "a", level: "pass" as const, text: "Marker matches." },
  { code: "b", level: "block" as const, text: "Plant column missing.", fix: { label: "Get template", href: "#t" } },
];
const RUNS: RunOption[] = [
  { id: "r2", number: 2, status: "done", kind: "Cleaned", dateLabel: "2 Nov" },
  { id: "r1", number: 1, status: "done", kind: "Extracted", dateLabel: "1 Nov" },
];

afterEach(() => vi.unstubAllGlobals());

describe("LargeTitle", () => {
  it("sets data-collapsed on the scope when the sentinel leaves the view", () => {
    let cb: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal("IntersectionObserver", class { constructor(f: IntersectionObserverCallback) { cb = f; } observe() {} disconnect() {} });
    const onClick = vi.fn();
    const { container } = render(<div data-title-scope><LargeTitle title="Portfolio" subtitle="All objects" primary={{ label: "Start", onClick }} /></div>);
    expect(screen.getByRole("heading", { level: 1, name: "Portfolio" })).toBeTruthy();
    const scope = container.firstElementChild as HTMLElement;
    act(() => cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(scope.dataset.collapsed).toBe("true");
    act(() => cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(scope.dataset.collapsed).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Toolbar", () => {
  it("shows three actions, the rest in a menu that Esc closes", async () => {
    const u = userEvent.setup();
    const last = vi.fn();
    const acts = ["a", "b", "c", "d"].map((id) => ({ id, label: `Do ${id}`, onClick: id === "d" ? last : () => undefined }));
    render(<Toolbar title="Objects" actions={acts} />);
    expect(screen.getByRole("toolbar", { name: "Objects" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Do d" })).toBeNull();
    const more = screen.getByRole("button", { name: "More actions" });
    await u.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Do d" }));
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
    await u.click(more);
    await u.keyboard("{Enter}");
    expect(last).toHaveBeenCalled();
  });
});

describe("FeedCard", () => {
  it("links the whole card through the title and keeps actions separate", async () => {
    const run = vi.fn();
    render(<FeedCard title="Seal kit" reason="Score fell." tone="bad" href="/o/1" meta={[{ label: "Score", value: "58" }]} actions={[{ label: "Fix", onClick: run, primary: true }]} />);
    expect(screen.getByRole("link", { name: "Seal kit" }).getAttribute("href")).toBe("/o/1");
    expect(screen.getByText("Score fell.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(run).toHaveBeenCalled();
  });
});

describe("CheckList", () => {
  it("states each level in words and offers the fix", () => {
    render(<CheckList checks={CHECKS} />);
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get template" }).getAttribute("href")).toBe("#t");
  });
});

describe("Composer", () => {
  it("grows, sends on Ctrl+Enter, clears and toasts", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ToastProvider><Composer label="Note" placeholder="Add a note" submitLabel="Send" doneText="Note sent" onSubmit={onSubmit} /></ToastProvider>);
    const box = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(box, { target: { value: "  hello  " } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("hello"));
    await waitFor(() => expect(box.value).toBe(""));
    expect(await screen.findByText("Note sent")).toBeTruthy();
  });
  it("keeps the text and says so when the send fails", async () => {
    render(<ToastProvider><Composer label="Note" placeholder="p" submitLabel="Send" onSubmit={() => { throw new Error("Server said no."); }} /></ToastProvider>);
    const box = screen.getByLabelText("Note") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Server said no.");
    expect(box.value).toBe("x");
  });
});

describe("ObjectSegments", () => {
  const V = { object: "a", version: "v1", run: "r2" };
  const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String.fromCharCode(97 + i), label: `Obj ${i}` }));
  it("uses radio groups up to four and the run label is the run sentence", async () => {
    const onChange = vi.fn();
    render(<ObjectSegments objects={opts(2)} versions={[{ id: "v1", label: "V1" }]} runs={RUNS} value={V} onChange={onChange} />);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
    await userEvent.click(screen.getByRole("radio", { name: "Obj 1" }));
    expect(onChange).toHaveBeenCalledWith({ ...V, object: "b" });
    expect(screen.getByRole("radio", { name: "Run 2, cleaned, 2 Nov" })).toBeTruthy();
  });
  it("switches to a filterable list above four", async () => {
    function Host() { const [v, setV] = useState(V); return <ObjectSegments objects={opts(6)} versions={[{ id: "v1", label: "V1" }]} runs={RUNS} value={v} onChange={setV} />; }
    const u = userEvent.setup();
    render(<Host />);
    await u.click(screen.getByRole("button", { name: "Object: Obj 0" }));
    await u.keyboard("Obj 4");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await u.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Object: Obj 4" })).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("StepFlow gate", () => {
  const steps = (gate: CheckResult[]) => [{ id: "a", label: "Upload", body: <p>body</p>, gate, hint: "Scoring takes two minutes." }, { id: "b", label: "Score", body: <p>done</p> }];
  it("blocks the primary while a gate blocks, with the sentence as reason", () => {
    render(<StepFlow steps={steps(CHECKS)} label="job" />);
    expect(screen.getByRole("button", { name: "Next" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText("Plant column missing.").length).toBeGreaterThan(0);
    expect(screen.getByText("Scoring takes two minutes.")).toBeTruthy();
  });
  it("asks before moving on a warning", async () => {
    render(<StepFlow steps={steps([{ code: "w", level: "warn", text: "12 new rows." }])} label="job" />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue anyway" }));
    await waitFor(() => expect(screen.getByTestId("flow-step-b")).toBeTruthy());
  });
});
