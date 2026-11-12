import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Button, Chip, Code, CommandPalette, Confirm, DataTable, DropZone, EmptyState, ErrorState, ProgressBar,
  SegmentedControl, SidePanel, Skeleton, Stepper, Tabs, ToastProvider, useToast,
} from "../kit";

describe("Button", () => {
  it("click calls, loading and disabled swallow", async () => {
    const fn = vi.fn();
    const u = userEvent.setup();
    const { rerender } = render(<Button onClick={fn}>Go</Button>);
    await u.click(screen.getByRole("button", { name: "Go" }));
    expect(fn).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={fn} disabled reason="Pick a run first">Go</Button>);
    await u.click(screen.getByRole("button", { name: /Go/ }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Pick a run first")).toBeTruthy();
    rerender(<Button onClick={fn} loading>Go</Button>);
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
  });
});

describe("Chip and states", () => {
  it("renders", () => {
    render(<><Chip tone="good" count={1200}>ready</Chip><Skeleton /><ProgressBar value={40} label="Pull" /><ErrorState sentence="Pull failed." /><EmptyState heading="Nothing yet" /></>);
    expect(screen.getByText("ready")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Pull" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByRole("alert").textContent).toContain("Pull failed.");
    expect(screen.getByRole("heading", { name: "Nothing yet" })).toBeTruthy();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });
  it("Code renders text", () => {
    render(<Code code="MATNR" />);
    expect(screen.getByText("MATNR")).toBeTruthy();
  });
});

describe("Tabs and SegmentedControl", () => {
  it("arrow keys change value", async () => {
    const u = userEvent.setup();
    const T = () => {
      const [v, setV] = useState("a");
      return <Tabs label="Views" value={v} onChange={setV} items={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} />;
    };
    render(<T />);
    screen.getByRole("tab", { name: "A" }).focus();
    await u.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "B" }).getAttribute("aria-selected")).toBe("true");
    const onChange = vi.fn();
    render(<SegmentedControl label="Density" value="x" onChange={onChange} items={[{ value: "x", label: "X" }, { value: "y", label: "Y" }]} />);
    screen.getByRole("radio", { name: "X" }).focus();
    await u.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("y");
  });
});

describe("Stepper", () => {
  it("marks current step", () => {
    render(<Stepper label="Steps" steps={[{ id: "1", label: "Pull", state: "done" }, { id: "2", label: "Clean", state: "current" }]} />);
    expect(document.querySelector('[aria-current="step"]')).toBeTruthy();
  });
});

type Row = { id: string; n: string };
const rows: Row[] = [{ id: "1", n: "b" }, { id: "2", n: "a" }];
const cols = [{ id: "n", label: "Name", cell: (r: Row) => r.n, compare: (a: Row, b: Row) => a.n.localeCompare(b.n) }];
const table = (extra = {}) => <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} rowLabel={(r) => `row ${r.n}`} caption="Rows" {...extra} />;

describe("DataTable", () => {
  it("sorts with aria-sort and selects", async () => {
    const u = userEvent.setup();
    render(table({ selectable: true, bulkActions: (k: string[]) => <span>{k.length} picked</span> }));
    await u.click(screen.getByRole("button", { name: /Name/ }));
    expect(document.querySelector('[aria-sort="ascending"]')).toBeTruthy();
    await u.click(screen.getByRole("checkbox", { name: /row a/ }));
    expect(screen.getByText("1 picked")).toBeTruthy();
  });
  it("shows empty, error and loading", () => {
    const { rerender } = render(table({ rows: [], empty: { heading: "No rows" } }));
    expect(screen.getByText("No rows")).toBeTruthy();
    rerender(table({ error: { sentence: "Broke." } }));
    expect(screen.getByRole("alert").textContent).toContain("Broke.");
    rerender(table({ loading: true }));
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });
});

describe("overlays", () => {
  it("SidePanel closes on Esc", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    render(<SidePanel open title="Detail" onClose={onClose}><p>body</p></SidePanel>);
    await u.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
  it("Confirm needs the phrase", async () => {
    const u = userEvent.setup();
    const ok = vi.fn();
    render(<Confirm open title="Write" consequence="Writes 4 records" confirmLabel="Write" phrase="WRITE" onConfirm={ok} onCancel={() => {}} />);
    await u.click(screen.getByRole("button", { name: /^Write/ }));
    expect(ok).not.toHaveBeenCalled();
    await u.type(screen.getByRole("textbox"), "WRITE");
    await u.click(screen.getByRole("button", { name: /^Write/ }));
    expect(ok).toHaveBeenCalled();
  });
  it("Toast keeps three and one live region", async () => {
    const u = userEvent.setup();
    const S = () => {
      const push = useToast();
      return <button onClick={() => push({ text: `t${Math.random()}`, timeout: 0 })}>add</button>;
    };
    render(<ToastProvider><S /></ToastProvider>);
    for (let i = 0; i < 5; i++) await u.click(screen.getByText("add"));
    expect(document.querySelectorAll(".nx-toast-item").length).toBe(3);
    expect(document.querySelectorAll('[aria-live="polite"]').length).toBe(1);
  });
  it("CommandPalette filters and runs on Enter", async () => {
    const u = userEvent.setup();
    const run = vi.fn();
    render(<CommandPalette open onClose={() => {}} groups={[{ id: "g", label: "Go", items: [{ id: "a", label: "Open runs", run }, { id: "b", label: "Settings", run: () => {} }] }]} />);
    await u.type(screen.getByRole("combobox"), "runs");
    expect(screen.queryByText("Settings")).toBeNull();
    await u.keyboard("{Enter}");
    expect(run).toHaveBeenCalled();
  });
});

describe("DropZone", () => {
  it("passes files", async () => {
    const u = userEvent.setup();
    const onFiles = vi.fn();
    const { container } = render(<DropZone onFiles={onFiles} hint="xlsx only" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await u.upload(input, new File(["x"], "a.xlsx"));
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(within(container).getByText("xlsx only")).toBeTruthy();
  });
});
