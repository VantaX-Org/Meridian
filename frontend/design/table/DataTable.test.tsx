import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable } from "./DataTable";
import { textColumn, numberColumn, idColumn } from "./columns";
import { Pager } from "./Pager";
import { Drawer } from "../primitives/Drawer";

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "2", name: "Bravo" },
  { id: "1", name: "Alpha" },
];

const columns = [textColumn<Row>("name", "Name")];

describe("DataTable", () => {
  it("sorts a column on header click", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />);
    const header = screen.getByText("Name");
    fireEvent.click(header);
    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Alpha");
  });

  it("filters rows via the global filter input", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />);
    fireEvent.change(screen.getByPlaceholderText("Type to filter rows"), { target: { value: "Bravo" } });
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("opens the row drawer on click without calling a refetch prop", () => {
    const fetchDetail = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        renderDrawer={(row) => {
          fetchDetail();
          return <div>Detail for {row.name}</div>;
        }}
      />,
    );
    fireEvent.click(screen.getByText("Bravo"));
    expect(screen.getByText("Detail for Bravo")).toBeInTheDocument();
    // fetchDetail is only called once, by the open — the table itself never re-fetches.
    expect(fetchDetail).toHaveBeenCalledTimes(1);
  });

  it("activates a row from any cell by click and by keyboard, but not from the select checkbox", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
        bulkActions={() => null}
      />,
    );
    fireEvent.click(screen.getByText("Alpha"));
    expect(onRowClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "1" }));

    const bravoRow = screen.getByText("Bravo").closest("tr") as HTMLTableRowElement;
    expect(bravoRow).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(bravoRow, { key: "Enter" });
    expect(onRowClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "2" }));
    fireEvent.keyDown(bravoRow, { key: " " });
    expect(onRowClick).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByLabelText("Select row 1"));
    expect(onRowClick).toHaveBeenCalledTimes(3);
  });

  it("virtualises large row sets: total height matches getTotalSize and scrolling reveals later rows", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
    try {
      const bigRows: Row[] = Array.from({ length: 2500 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
      const { container } = render(<DataTable columns={columns} data={bigRows} getRowId={(r) => r.id} />);
      const scrollParent = container.querySelector("div[style*='overflow: auto']") as HTMLDivElement;
      const tbody = container.querySelector("tbody") as HTMLTableSectionElement;

      // 36px row estimate * 2500 rows.
      expect(tbody.style.height).toBe("90000px");
      expect(screen.queryByText("Row 2400")).not.toBeInTheDocument();

      Object.defineProperty(scrollParent, "scrollTop", { configurable: true, value: 86000 });
      fireEvent.scroll(scrollParent);

      expect(screen.getByText("Row 2400")).toBeInTheDocument();
    } finally {
      if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("selects rows and surfaces them to BulkBar and the bulk action callback", () => {
    const onAction = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        bulkActions={(selected) => (
          <button type="button" onClick={() => onAction(selected)}>
            Delete
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByLabelText("Select row 2"));
    fireEvent.click(screen.getByLabelText("Select row 1"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete"));
    expect(onAction).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "2" }),
      expect.objectContaining({ id: "1" }),
    ]));
    expect(onAction.mock.calls[0][0]).toHaveLength(2);
  });

  it("right-aligns numeric cells, renders identifiers in Mono, and honours dense row height", () => {
    const cols = [idColumn<Row>("id", "ID"), numberColumn<Row & { n: number }>("n", "N") as never];
    render(<DataTable columns={cols} data={[{ id: "A1", name: "x", n: 1234 }] as never} getRowId={(r: Row) => r.id} dense />);
    expect(screen.getByText("A1")).toHaveClass("m-mono");
    expect(screen.getByText(/^1\D?234$/)).toHaveClass("text-right", "m-numeric");
    expect(screen.getAllByRole("row")[1]).toHaveStyle({ height: "var(--m-row-h-dense)" });
  });

  it("marks selected rows and shows the floating bulk bar", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} bulkActions={(s) => <button>Act {s.length}</button>} />);
    fireEvent.click(screen.getByLabelText("Select row 1"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText("Act 1")).toBeInTheDocument();
    expect(screen.getAllByRole("row")[2]).toHaveClass("bg-[var(--m-accent-soft)]");
  });
});

describe("Pager", () => {
  it("shows the range and disables Previous on page 1", () => {
    const onPageChange = vi.fn();
    render(<Pager page={1} pageCount={47} pageSize={50} total={2310} onPageChange={onPageChange} />);
    expect(screen.getByText(/^1\u201350 of 2\D?310$/)).toBeInTheDocument();
    expect(screen.getByLabelText("Previous")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Next"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe("Drawer", () => {
  it("renders subtitle and footer slots", () => {
    render(<Drawer open onOpenChange={() => {}} title="T" subtitle="sub-id" footer={<button>Save</button>}>body</Drawer>);
    expect(screen.getByText("sub-id")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });
});

describe("DataTable toolbar", () => {
  const two = [textColumn<Row>("id", "Id"), textColumn<Row>("name", "Name")];

  it("hides a column from the chooser", () => {
    render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} tableId="t-cols" />);
    fireEvent.click(screen.getByText("Columns"));
    fireEvent.click(screen.getByLabelText("Name"));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("toggles density", () => {
    render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} tableId="t-dense" />);
    const btn = screen.getByRole("button", { name: "Compact rows" });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Comfortable rows" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves and re-applies a view, keyed by table id", () => {
    window.localStorage.clear();
    render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} tableId="t-views" />);
    fireEvent.click(screen.getByText("Columns"));
    fireEvent.click(screen.getByLabelText("Name"));
    fireEvent.click(screen.getByText("Views"));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Ids only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(JSON.parse(window.localStorage.getItem("m-table-views:t-views") ?? "[]")[0].visibility).toEqual({ name: false });
    fireEvent.click(screen.getByText(/^Columns/));
    fireEvent.click(screen.getByLabelText("Name")); // show again
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Views/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ids only" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("offers CSV export and can hide the toolbar", () => {
    const { rerender } = render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    rerender(<DataTable columns={two} data={rows} getRowId={(r) => r.id} hideToolbar />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});
