import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "./DataTable";
import type { GridApi } from "./useGridState";

interface R { id: string; name: string; n: number }
const cols: Column<R>[] = [{ key: "name", label: "Name", sort: (r) => r.name }, { key: "n", label: "Count", sort: (r) => r.n, align: "end" }];
const rows: R[] = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, name: `Row ${String(i).padStart(3, "0")}`, n: i }));
const names = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent);

describe("DataTable", () => {
  it("caps its height instead of fixing it, so a short table has no empty space", () => {
    render(<DataTable columns={cols} rows={rows.slice(0, 2)} rowKey={(r) => r.id} label="Records" height={200} />);
    const box = screen.getByRole("group", { name: "Records" }) as HTMLElement;
    expect(box.style.maxBlockSize).toBe("200px");
    expect(box.style.blockSize).toBe("");
  });
  it("renders only the rows in view", () => {
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" height={200} rowHeight={40} />);
    expect(screen.getAllByRole("row").length).toBeLessThan(20);
    expect(screen.getByText("Row 000")).toBeTruthy();
  });
  it("renders further rows after a scroll", () => {
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" height={200} rowHeight={40} />);
    fireEvent.scroll(screen.getByRole("group", { name: "Records" }), { target: { scrollTop: 4000 } });
    expect(screen.getByText("Row 100")).toBeTruthy();
    expect(screen.queryByText("Row 000")).toBeNull();
  });
  it("sorts ascending, then descending, then back", () => {
    render(<DataTable columns={cols} rows={rows.slice(0, 5)} rowKey={(r) => r.id} label="Records" />);
    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(screen.getByRole("columnheader", { name: "Count" }).getAttribute("aria-sort")).toBe("descending");
    expect(names()[0]).toContain("Row 004");
    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(names()[0]).toContain("Row 000");
  });
  it("selects a row by click and by keyboard", () => {
    const on = vi.fn();
    render(<DataTable columns={cols} rows={rows.slice(0, 5)} rowKey={(r) => r.id} label="Records" selected="r1" onSelect={(r) => on(r.id)} />);
    expect(screen.getByText("Row 001").closest("tr")?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByText("Row 003"));
    expect(on).toHaveBeenLastCalledWith("r3");
    const box = screen.getByRole("group", { name: "Records" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(on).toHaveBeenLastCalledWith("r4");
    fireEvent.keyDown(box, { key: "Home" });
    fireEvent.keyDown(box, { key: " " });
    expect(on).toHaveBeenLastCalledWith("r0");
  });
  it("leaves a URL-backed sort alone when the column list changes, so the route is not replaced in a loop", () => {
    const grid: GridApi = { sort: { key: "n", dir: "desc" }, filters: {}, groupBy: null, open: null, setSort: vi.fn(), setFilter: vi.fn(), clearFilters: vi.fn(), setGroupBy: vi.fn(), setOpen: vi.fn() };
    const { rerender } = render(<DataTable id="loop" grid={grid} columns={[...cols]} rows={rows.slice(0, 3)} rowKey={(r) => r.id} label="Records" />);
    rerender(<DataTable id="loop" grid={grid} columns={[...cols]} rows={rows.slice(0, 3)} rowKey={(r) => r.id} label="Records" />);
    expect(grid.setSort).not.toHaveBeenCalled();
  });
});
