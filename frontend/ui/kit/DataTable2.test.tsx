import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "./DataTable";
import { TrendArea } from "./TrendArea";

interface R { id: string; name: string; n: number }
const cols: Column<R>[] = [{ key: "name", label: "Name", sort: (r) => r.name }, { key: "n", label: "Count", sort: (r) => r.n, align: "end" }, { key: "x", label: "Extra", defaultHidden: true, render: () => "x" }];
const rows: R[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Row ${String(i).padStart(2, "0")}`, n: i }));
const heads = () => screen.getAllByRole("columnheader").map((h) => h.textContent);

beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, "", "/"); });
afterEach(cleanup);

function Picker({ onRun }: { onRun: (k: string[]) => void }) {
  const [keys, setKeys] = useState<string[]>([]);
  return <DataTable id="t" columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" selection="multi" selectedKeys={keys} onSelectedKeys={setKeys} matching={100} onSelectAllMatching={() => setKeys(["all"])} bulkActions={[{ id: "d", label: "Remove", danger: true, run: onRun }]} />;
}

describe("DataTable v2", () => {
  it("hides, shows and reorders columns, and keeps the choice", () => {
    const { unmount } = render(<DataTable id="t" columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" />);
    expect(heads().filter(Boolean)).toEqual(["Name", "Count"]);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Extra"));
    fireEvent.click(screen.getByRole("button", { name: "Move Count earlier" }));
    expect(heads().filter(Boolean)).toEqual(["Count", "Name", "Extra"]);
    unmount();
    render(<DataTable id="t" columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" />);
    expect(heads().filter(Boolean)).toEqual(["Count", "Name", "Extra"]);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(heads().filter(Boolean)).toEqual(["Name", "Count"]);
  });
  it("saves a view and restores it from the URL", () => {
    const { unmount } = render(<DataTable id="t" columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByLabelText("Extra"));
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Wide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(window.location.search).toBe("?view=Wide");
    unmount();
    window.localStorage.removeItem("mx.table.t");
    render(<DataTable id="t" columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" />);
    expect(heads().filter(Boolean)).toContain("Extra");
  });
  it("selects the page, offers all that match, and confirms a destructive action with the count", () => {
    const run = vi.fn();
    render(<Picker onRun={run} />);
    fireEvent.click(screen.getByLabelText("Select all rows"));
    expect(screen.getByText("30 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select all 100 that match" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    expect(run).toHaveBeenCalledWith(["all"]);
  });
  it("shows paging counts", () => {
    const onPage = vi.fn();
    render(<DataTable id="t" columns={cols} rows={rows.slice(0, 25)} rowKey={(r) => r.id} label="Records" paging={{ page: 2, pageSize: 25, total: 515, onPage, onPageSize: () => {} }} />);
    expect(screen.getByText("26 to 50 of 515")).toBeTruthy();
    expect(screen.getByText("Page 2 of 21")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(3);
  });
  it("shows only the row count for an in-memory table", () => {
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} label="Records" footer />);
    expect(screen.getByText("30 rows")).toBeTruthy();
  });
});

describe("chart frame", () => {
  it("states the reading and swaps the plot for its table", () => {
    render(<TrendArea label="Score" emptyLabel="none" points={[{ axis: "a", title: "Run 1", value: 60 }, { axis: "b", title: "Run 2", value: 71.5 }]} />);
    expect(screen.getByText("From 60.0 to 71.5 over 2 points")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getByText("Run 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show as chart" })).toBeTruthy();
  });
});
