import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Badge, CodeView, CommentsPanel, CycleStepper, DataTable, DiffView, FileDrop, Graph, Hairline, Textarea, Timeline, UndoToast } from "./index";

describe("kit follow-up components", () => {
  it("Badge carries tone", () => {
    render(<Badge tone="bad">3</Badge>);
    expect(screen.getByText("3").getAttribute("data-tone")).toBe("bad");
  });
  it("Textarea types", () => {
    render(<Textarea aria-label="n" mono />);
    fireEvent.change(screen.getByLabelText("n"), { target: { value: "x" } });
    expect((screen.getByLabelText("n") as HTMLTextAreaElement).value).toBe("x");
  });
  it("CodeView and DiffView", () => {
    render(<><CodeView label="code" text="a: 1" /><DiffView label="diff" diff={"  a\n+ b\n- c"} /></>);
    expect(screen.getByLabelText("code").textContent).toBe("a: 1");
    expect(document.querySelectorAll("[data-kind=add]").length).toBe(1);
    expect(document.querySelectorAll("[data-kind=del]").length).toBe(1);
  });
  it("FileDrop passes the file", () => {
    const f = vi.fn();
    render(<FileDrop accept=".csv" onFile={f} label="Pick" status="none" />);
    const file = new File(["a"], "a.csv");
    fireEvent.change(screen.getByLabelText("Pick"), { target: { files: [file] } });
    expect(f).toHaveBeenCalledWith(file);
  });
  it("Hairline shows bars and hides when empty", () => {
    const { rerender, container } = render(<Hairline label="Jobs" items={[{ id: "a", label: "A", meta: "40%", pct: 40 }]} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    rerender(<Hairline label="Jobs" items={[]} />);
    expect(container.firstChild).toBeNull();
  });
  it("Timeline lists events", () => {
    render(<Timeline label="h" events={[{ id: "a", at: "1 Nov", title: "Start" }]} />);
    expect(screen.getByText("Start")).toBeTruthy();
  });
  it("UndoToast fires", () => {
    const f = vi.fn();
    render(<UndoToast message="Done" actionLabel="Undo" onAction={f} />);
    fireEvent.click(screen.getByText("Undo"));
    expect(f).toHaveBeenCalled();
  });
  it("CycleStepper marks the step", () => {
    render(<CycleStepper label="c" step="upload" labels={{ pull: "Pull", clean: "Clean", upload: "Upload", score: "Score", compare: "Compare" }} />);
    expect(screen.getAllByText("Upload")[0].closest("li")?.getAttribute("aria-current")).toBe("step");
  });
  it("Graph draws nodes and picks edges by key", () => {
    const pick = vi.fn();
    render(<Graph layout="circle" label="g" nodes={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} edges={[{ id: "e", source: "a", target: "b", label: "90%" }]} onPick={pick} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(pick).toHaveBeenCalled();
    render(<Graph layout="columns" label="g2" nodes={[{ id: "a", label: "A", column: 0 }]} edges={[]} />);
    expect(screen.getByLabelText("g2")).toBeTruthy();
  });
  it("CommentsPanel adds and clears", async () => {
    const add = vi.fn();
    render(<CommentsPanel items={[]} listLabel="l" empty={<p>None</p>} composer={{ label: "New", submitLabel: "Add", onSubmit: add }} />);
    expect(screen.getByText("None")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New"), { target: { value: " hi " } });
    fireEvent.click(screen.getByText("Add"));
    await vi.waitFor(() => expect(add).toHaveBeenCalledWith("hi"));
  });
  it("DataTable expands one row", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    render(<DataTable label="t" rows={rows} rowKey={(r) => r.id} columns={[{ key: "id", label: "Id" }]} expand={{ id: "a", height: 50, render: (r) => <i>open {r.id}</i> }} />);
    expect(screen.getByText("open a")).toBeTruthy();
  });
});
