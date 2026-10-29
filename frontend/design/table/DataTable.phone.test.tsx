import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, TOOLBAR_MIN_ROWS } from "./DataTable";
import { columnLayoutClass, isActionColumn, isStatusColumn, layoutMeta, textColumn } from "./columns";

interface Item {
  id: string;
  name: string;
  status: string;
  owner: string;
  note: string;
}

const make = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), name: `Item ${i}`, status: i % 2 ? "Blocked" : "Ready", owner: `Owner ${i}`, note: "" }));

const columns: ColumnDef<Item>[] = [
  textColumn<Item>("name", "Name"),
  { ...textColumn<Item>("owner", "Owner"), meta: { priority: "low" } },
  { ...textColumn<Item>("status", "Status"), meta: { priority: "low" } },
  textColumn<Item>("note", "Note"),
  { id: "action", header: "Action", cell: ({ row }) => <a href={`/items/${row.original.id}`}>Open</a>, meta: { priority: "low" } },
];

function phoneViewport(on: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: on && q === "(max-width: 639px)", media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return () => { window.matchMedia = original; };
}

describe("DataTable toolbar threshold", () => {
  it("keeps only the export on a short table: no view options and no filter box", () => {
    render(<DataTable columns={columns} data={make(TOOLBAR_MIN_ROWS)} getRowId={(r) => r.id} />);
    expect(screen.queryByText("Columns")).toBeNull();
    expect(screen.queryByText("Compact rows")).toBeNull();
    expect(screen.queryByLabelText("Filter rows")).toBeNull();
    expect(screen.getByText("Export table")).toBeInTheDocument();
  });

  it("shows nothing above a short table whose page has its own export", () => {
    render(<DataTable columns={columns} data={make(TOOLBAR_MIN_ROWS)} getRowId={(r) => r.id} hideExport />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("shows the toolbar above the threshold and keeps it while a filter is active", () => {
    render(<DataTable columns={columns} data={make(TOOLBAR_MIN_ROWS + 1)} getRowId={(r) => r.id} />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "Item 3" } });
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter rows")).toHaveValue("Item 3");
  });

  it("hides the table's own export on request, leaving the rest of the toolbar", () => {
    render(<DataTable columns={columns} data={make(TOOLBAR_MIN_ROWS + 1)} getRowId={(r) => r.id} hideExport />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.queryByText("Export table")).toBeNull();
  });
});

describe("DataTable hideEmptyColumns", () => {
  it("drops a column that is empty in every row, and only that one", () => {
    render(<DataTable columns={columns} data={make(3)} getRowId={(r) => r.id} hideEmptyColumns />);
    expect(screen.queryByRole("columnheader", { name: "Note" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
  });

  it("keeps every column by default", () => {
    render(<DataTable columns={columns} data={make(3)} getRowId={(r) => r.id} />);
    expect(screen.getByRole("columnheader", { name: "Note" })).toBeInTheDocument();
  });
});

describe("DataTable phone layout", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("never marks the action or the status column as hidden on a phone", () => {
    expect(columnLayoutClass(layoutMeta("owner", { priority: "low" }))).toContain("max-[640px]:hidden");
    expect(columnLayoutClass(layoutMeta("status", { priority: "low" }))).not.toContain("hidden");
    expect(columnLayoutClass(layoutMeta("action", { priority: "low" }))).not.toContain("hidden");
    expect(columnLayoutClass(layoutMeta("verdict", { priority: "low" }))).not.toContain("hidden");
    expect(columnLayoutClass(layoutMeta("sev", { severity: true, priority: "low" }))).not.toContain("hidden");
    expect(isActionColumn("actions")).toBe(true);
    expect(isStatusColumn("Verdict", undefined)).toBe(true);
  });

  it("renders each row as a card on a phone: first column as title, status and action visible, the rest as label and value", () => {
    restore = phoneViewport(true);
    render(<DataTable columns={columns} data={make(3)} getRowId={(r) => r.id} />);
    expect(screen.queryByRole("grid")).toBeNull();
    const cards = within(screen.getByTestId("table-cards")).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    const second = cards[1];
    expect(within(second).getByText("Item 1")).toBeInTheDocument();
    expect(within(second).getByText("Blocked")).toBeInTheDocument();
    expect(within(second).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/items/1");
    // other columns read as label and value; the empty note adds no line
    expect(within(second).getByText("Owner")).toBeInTheDocument();
    expect(within(second).getByText("Owner 1")).toBeInTheDocument();
    expect(within(second).queryByText("Note")).toBeNull();
  });

  it("keeps the table on a phone when asked to", () => {
    restore = phoneViewport(true);
    render(<DataTable columns={columns} data={make(3)} getRowId={(r) => r.id} phoneLayout="table" />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.queryByTestId("table-cards")).toBeNull();
  });

  it("keeps the table on wider screens", () => {
    restore = phoneViewport(false);
    render(<DataTable columns={columns} data={make(3)} getRowId={(r) => r.id} />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("opens a row from its card and lets the action take its own click", () => {
    restore = phoneViewport(true);
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={make(2)} getRowId={(r) => r.id} onRowClick={onRowClick} />);
    const cards = within(screen.getByTestId("table-cards")).getAllByRole("listitem");
    fireEvent.click(within(cards[0]).getByRole("link", { name: "Open" }));
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(cards[1]);
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  it("selects a card with its own checkbox when the table has bulk actions", () => {
    restore = phoneViewport(true);
    render(<DataTable columns={columns} data={make(2)} getRowId={(r) => r.id} bulkActions={(rows) => <span>{rows.length} picked</span>} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Item 0" }));
    expect(screen.getByText("1 picked")).toBeInTheDocument();
  });
});
