import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "./DataTable";
import type { GridApi } from "./useGridState";

interface R { id: string; name: string; kind: string; n: number }
const mk = (i: number): R => ({ id: `r${i}`, name: `Row ${String(i).padStart(3, "0")}`, kind: i % 2 ? "odd" : "even", n: i });
const rows = Array.from({ length: 6 }, (_, i) => mk(i));
const cols: Column<R>[] = [
  { key: "name", label: "Name", sort: (r) => r.name },
  { key: "kind", label: "Kind", value: (r) => r.kind, groupable: true },
  { key: "n", label: "Count", sort: (r) => r.n },
];
const names = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent);
afterEach(cleanup);

function api(over: Partial<GridApi> = {}): GridApi {
  return { sort: null, filters: {}, groupBy: null, open: null, setSort: vi.fn(), setFilter: vi.fn(), clearFilters: vi.fn(), setGroupBy: vi.fn(), setOpen: vi.fn(), ...over } as GridApi;
}

describe("DataTable grid state", () => {
  it("sends sort, filter and group changes to the grid api", () => {
    const g = api();
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="L" grid={g} filters={[{ column: "kind", label: "Kind", options: [{ value: "odd", label: "Odd" }] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(g.setSort).toHaveBeenCalledWith({ key: "name", dir: "asc" });
    fireEvent.click(screen.getByRole("button", { name: "Odd" }));
    expect(g.setFilter).toHaveBeenCalledWith("kind", ["odd"]);
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "kind" } });
    expect(g.setGroupBy).toHaveBeenCalledWith("kind");
  });

  it("applies filters from the grid and groups with counts and folds", () => {
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="L" grid={api({ groupBy: "kind", filters: {} })} groupSum={{ label: "Total", value: (r) => r.n }} />);
    expect(screen.getByText(/Kind: even/)).toBeTruthy();
    expect(screen.getByText(/Total 6/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Kind: even/ }));
    expect(screen.queryByText("Row 000")).toBeNull();
    expect(screen.getByText("Row 001")).toBeTruthy();
  });

  it("filters rows by chosen values", () => {
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="L" grid={api({ filters: { kind: ["odd"] } })} />);
    expect(names()).toHaveLength(3);
  });

  it("moves with J and K, opens with Enter, closes with Escape", () => {
    const onSelect = vi.fn();
    const g = api();
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="L" grid={g} onSelect={onSelect} />);
    const box = screen.getByRole("group");
    fireEvent.keyDown(box, { key: "j" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(rows[1]);
    expect(g.setOpen).toHaveBeenCalledWith("r1");
    fireEvent.keyDown(box, { key: "k" });
    expect(box.getAttribute("aria-activedescendant")).toBe("mx-row-r0");
  });

  it("Escape closes the open row", () => {
    const g = api({ open: "r2" });
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="L" grid={g} />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(g.setOpen).toHaveBeenCalledWith(null);
  });

  it("X toggles selection of the active row", () => {
    function T() {
      const [k, setK] = useState<string[]>([]);
      return <><DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="L" selection="multi" selectedKeys={k} onSelectedKeys={setK} bulkBar={(ks) => <span>bulk {ks.length}</span>} /><output>{k.join(",")}</output></>;
    }
    render(<T />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "x" });
    expect(screen.getByRole("status").textContent).toBe("r0");
    expect(screen.getByText("bulk 1")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("edits a cell with F2, commits on Enter and cancels on Escape", () => {
    const onCommit = vi.fn();
    const ec: Column<R>[] = [{ ...cols[0], edit: { value: (r) => r.name, onCommit, label: "Edit name" } }, cols[1]];
    render(<DataTable columns={ec} rows={rows} rowKey={(r) => r.id} label="L" />);
    const box = screen.getByRole("group");
    fireEvent.keyDown(box, { key: "F2" });
    const input = screen.getByLabelText("Edit name");
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(rows[0], "New");
    fireEvent.keyDown(box, { key: "F2" });
    fireEvent.change(screen.getByLabelText("Edit name"), { target: { value: "Zed" } });
    fireEvent.keyDown(screen.getByLabelText("Edit name"), { key: "Escape" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Edit name")).toBeNull();
  });

  it("renders a real link per row and follows it on Enter", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="L" rowHref={(r) => `/o/${r.id}`} />);
    expect(document.querySelectorAll("a.mx-dt-link")[1].getAttribute("href")).toBe("/o/r1");
    fireEvent.keyDown(screen.getByRole("group"), { key: "Enter" });
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("virtualises only above 200 rows", () => {
    const many = Array.from({ length: 500 }, (_, i) => mk(i));
    const { unmount } = render(<DataTable columns={cols} rows={many} rowKey={(r) => r.id} label="L" />);
    expect(screen.getAllByRole("row").length).toBeLessThan(100);
    unmount();
    render(<DataTable columns={cols} rows={many.slice(0, 150)} rowKey={(r) => r.id} label="L" />);
    expect(screen.getAllByRole("row")).toHaveLength(151);
  });

  it("density prop forces the row height", () => {
    render(<DataTable id="d" columns={cols} rows={rows} rowKey={(r) => r.id} label="L" density="comfortable" />);
    expect(document.querySelector(".mx-dt")?.getAttribute("data-density")).toBe("comfortable");
  });
});
