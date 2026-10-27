import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DataTable } from "./DataTable";
import { textColumn, numberColumn, idColumn, barFill, type CellMeta } from "./columns";
import { Pager } from "./Pager";
import { RowAction, actionColumn, ROW_ACTION_CLASS } from "./RowAction";
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

  it("names the grid and each row's checkbox by what the row is, never its id", () => {
    const { unmount } = render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} bulkActions={() => null} />);
    expect(screen.getByRole("grid", { name: "Data table" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeInTheDocument();
    unmount();
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} bulkActions={() => null} label="Plants" rowLabel={(r) => `plant ${r.name}`} />);
    expect(screen.getByRole("grid", { name: "Plants" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select plant Bravo" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Select row/ })).toBeNull();
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

    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "Home" });
    const bravoRow = screen.getByText("Bravo").closest("tr") as HTMLTableRowElement;
    expect(grid).toHaveAttribute("aria-activedescendant", bravoRow.id);
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onRowClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "2" }));
    // Space selects, it does not open.
    fireEvent.keyDown(grid, { key: " " });
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Select Bravo")).toBeChecked();
    fireEvent.keyDown(grid, { key: "x" });
    expect(screen.getByLabelText("Select Bravo")).not.toBeChecked();
    fireEvent.keyDown(grid, { key: "End" });
    expect(grid).toHaveAttribute("aria-activedescendant", (screen.getByText("Alpha").closest("tr") as HTMLTableRowElement).id);
    fireEvent.keyDown(grid, { key: "Home" });
    expect(grid).toHaveAttribute("aria-activedescendant", bravoRow.id);

    fireEvent.click(screen.getByLabelText("Select Alpha"));
    expect(onRowClick).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(screen.getByLabelText("Select Alpha")).not.toBeChecked();
  });

  it("virtualises large row sets: total height matches getTotalSize and scrolling reveals later rows", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
    try {
      const bigRows: Row[] = Array.from({ length: 2500 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
      const { container } = render(<DataTable columns={columns} data={bigRows} getRowId={(r) => r.id} dense={false} />);
      const scrollParent = container.querySelector("div[style*='overflow: auto']") as HTMLDivElement;
      const tbody = container.querySelector("tbody") as HTMLTableSectionElement;
      // Spacer rows plus rendered rows always add up to 40px comfortable row * 2500 rows.
      const total = () =>
        Array.from(tbody.querySelectorAll("tr")).reduce((n, tr) => n + parseFloat((tr as HTMLElement).style.height), 0);

      expect(total()).toBe(100000);
      expect(screen.queryByText("Row 2400")).not.toBeInTheDocument();

      Object.defineProperty(scrollParent, "scrollTop", { configurable: true, value: 95800 });
      fireEvent.scroll(scrollParent);

      expect(screen.getByText("Row 2400")).toBeInTheDocument();
      expect(total()).toBe(100000);
      expect(screen.getByText("Row 2400").closest("tr")).toHaveAttribute("aria-rowindex", "2402");
      expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "2501");
    } finally {
      if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("renders every row at 200 rows and virtualises at 201", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
    try {
      const make = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
      const first = render(<DataTable columns={columns} data={make(200)} getRowId={(r) => r.id} />);
      expect(screen.getByText("Row 199")).toBeInTheDocument();
      expect(first.container.querySelectorAll("tbody tr")).toHaveLength(200);
      first.unmount();
      render(<DataTable columns={columns} data={make(201)} getRowId={(r) => r.id} />);
      expect(screen.queryByText("Row 200")).not.toBeInTheDocument();
    } finally {
      if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("renders every row of a 300-row table while printing", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q === "print", media: q, addEventListener: () => {}, removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const data: Row[] = Array.from({ length: 300 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
      const { container } = render(<DataTable columns={columns} data={data} getRowId={(r) => r.id} />);
      expect(container.querySelectorAll("tbody tr")).toHaveLength(300);
      expect(container.querySelector(".m-table-card .m-table-scroll")).not.toBeNull();
      // print.css keeps `.m-table-scroll th button` visible: sortable header labels live inside that button.
      expect(container.querySelector(".m-table-scroll th button")).not.toBeNull();
    } finally {
      window.matchMedia = original;
      if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("moves the active row with ArrowDown and ArrowUp and clamps at the ends", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    const idOf = (name: string) => (screen.getByText(name).closest("tr") as HTMLTableRowElement).id;
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid).toHaveAttribute("aria-activedescendant", idOf("Bravo"));
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid).toHaveAttribute("aria-activedescendant", idOf("Alpha"));
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid).toHaveAttribute("aria-activedescendant", idOf("Alpha"));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(grid).toHaveAttribute("aria-activedescendant", idOf("Bravo"));
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(grid).toHaveAttribute("aria-activedescendant", idOf("Bravo"));
  });

  it("keeps the active row on the same record after a sort and drops it when filtered out", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    const bravoId = (screen.getByText("Bravo").closest("tr") as HTMLTableRowElement).id;
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(grid).toHaveAttribute("aria-activedescendant", bravoId);
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "Alpha" } });
    expect(grid).not.toHaveAttribute("aria-activedescendant");
  });

  it("clears selection on Escape from a focused row checkbox, and select-all covers only filtered rows", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} bulkActions={() => null} />);
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "Alpha" } });
    fireEvent.click(screen.getByLabelText("Select all rows"));
    expect(screen.getByLabelText("Select Alpha")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "" } });
    expect(screen.getByLabelText("Select Bravo")).not.toBeChecked();
    fireEvent.keyDown(screen.getByLabelText("Select Alpha"), { key: "Escape" });
    expect(screen.getByLabelText("Select Alpha")).not.toBeChecked();
  });

  it("exposes grid row semantics", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} bulkActions={() => null} />);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
    const body = screen.getAllByRole("row").slice(1);
    expect(body.map((r) => r.getAttribute("aria-rowindex"))).toEqual(["2", "3"]);
    expect(body[0]).toHaveAttribute("aria-selected", "false");
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
    fireEvent.click(screen.getByLabelText("Select Bravo"));
    fireEvent.click(screen.getByLabelText("Select Alpha"));
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
    expect(screen.getAllByRole("row")[1]).toHaveStyle({ height: "32px" });
  });

  it("defaults to the 40px row and follows the user's density tier", async () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />);
    expect(screen.getAllByRole("row")[1]).toHaveStyle({ height: "40px" });
    document.documentElement.style.setProperty("--m-row-h", "48px");
    document.documentElement.dataset.density = "comfortable";
    try {
      await waitFor(() => expect(screen.getAllByRole("row")[1]).toHaveStyle({ height: "48px" }));
    } finally {
      document.documentElement.style.removeProperty("--m-row-h");
      delete document.documentElement.dataset.density;
    }
  });

  it("marks selected rows and shows the floating bulk bar", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} bulkActions={(s) => <button>Act {s.length}</button>} />);
    fireEvent.click(screen.getByLabelText("Select Alpha"));
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
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Name" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("toggles density", () => {
    render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} tableId="t-dense" dense={false} />);
    const btn = screen.getByRole("button", { name: "Compact rows" });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Comfortable rows" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves and re-applies a view, keyed by table id", () => {
    window.localStorage.clear();
    render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} tableId="t-views" />);
    fireEvent.click(screen.getByText("Columns"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Name" }));
    fireEvent.click(screen.getByText("Views"));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Ids only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    // Views live in the preferences document (saved_views by table id), written through to localStorage.
    expect(JSON.parse(window.localStorage.getItem("meridian:prefs") ?? "{}").saved_views["t-views"][0].visibility).toEqual({ name: false });
    // The Columns menu stays open after a toggle (checkbox items do not close it).
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Name" })); // show again
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Views/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ids only" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("offers shipped views beside the viewer's own and hands a view's page filters to the page", () => {
    window.localStorage.clear();
    const onApplyView = vi.fn();
    render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} tableId="t-preset" viewParams={{ sev: "high" }} onApplyView={onApplyView}
      presetViews={[{ name: "Critical", visibility: {}, dense: true, sorting: [], params: { sev: "critical" } }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Views (1)" }));
    expect(screen.queryByRole("button", { name: "Delete view Critical" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Critical" }));
    expect(onApplyView).toHaveBeenLastCalledWith(expect.objectContaining({ params: { sev: "critical" } }));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "High" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(JSON.parse(window.localStorage.getItem("meridian:prefs") ?? "{}").saved_views["t-preset"][0].params).toEqual({ sev: "high" });
  });

  it("takes a controlled active row, selection and order from a caller that owns them", () => {
    const onActive = vi.fn();
    const onSelection = vi.fn();
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} manualSorting rowTestId="r" activeRowId="1"
      onActiveRowChange={onActive} selection={{ "2": true }} onSelectionChange={onSelection} bulkActions={() => null} />);
    const trs = screen.getAllByTestId("r");
    // manualSorting: the caller's order stands.
    expect(trs.map((r) => r.textContent)).toEqual(["Bravo", "Alpha"]);
    expect(trs[1]).toHaveClass("m-row-active");
    expect(screen.getByRole("checkbox", { name: "Select Bravo" })).toBeChecked();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowUp" });
    expect(onActive).toHaveBeenCalledWith(rows[0]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(onSelection).toHaveBeenCalledWith({ "2": true, "1": true });
  });

  it("scrolls to a controlled active row when it changes, not on mount and not when rows load around it", () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      // The row the table mounts with (an auto-selection) is not scrolled to: the page stays at its top.
      const { rerender } = render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} manualSorting activeRowId="1" />);
      expect(scroll).not.toHaveBeenCalled();
      // The viewer moves the active row (j / k, arrows, a click): that one is followed.
      rerender(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} manualSorting activeRowId="2" />);
      expect(scroll).toHaveBeenCalledTimes(1);
      // The next page arrives and lands above the active row: its index moves, the viewer's scroll stays.
      const more = [{ id: "3", name: "Charlie" }, { id: "4", name: "Delta" }, ...rows];
      rerender(<DataTable columns={columns} data={more} getRowId={(r) => r.id} manualSorting activeRowId="2" />);
      expect(scroll).toHaveBeenCalledTimes(1);
      rerender(<DataTable columns={columns} data={more} getRowId={(r) => r.id} manualSorting activeRowId="4" />);
      expect(scroll).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("shows a filtered-empty row with a Clear filter button", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />);
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "zzz" } });
    expect(screen.getByText("No rows match this filter")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("titles the row drawer from drawerTitle", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} renderDrawer={(r) => <p>{r.name}</p>} drawerTitle="Row detail" />);
    fireEvent.click(screen.getByText("Alpha"));
    expect(screen.getByText("Row detail")).toBeInTheDocument();
  });

  it("offers CSV export and can hide the toolbar", () => {
    const { rerender } = render(<DataTable columns={two} data={rows} getRowId={(r) => r.id} />);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    rerender(<DataTable columns={two} data={rows} getRowId={(r) => r.id} hideToolbar />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});

describe("DataTable layout features", () => {
  it("expands a row into a detail panel and keeps the chevron labelled", () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} renderExpanded={(r) => <p>Detail of {r.name}</p>} />);
    expect(screen.queryByText("Detail of Alpha")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand row" })[0]);
    expect(screen.getByText(/^Detail of /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse row" })).toHaveAttribute("aria-expanded", "true");
  });

  it("draws an aria-hidden inline bar next to the number and sizes columns", () => {
    const cols = [
      { accessorKey: "n", header: "N", size: 120, meta: { numeric: true, bar: { max: 100, tone: "rate" } } satisfies CellMeta },
    ];
    const { container } = render(<DataTable columns={cols as never} data={[{ id: "a", n: 50 }] as never} getRowId={(r: { id: string }) => r.id} />);
    const fill = container.querySelector(".m-bar-fill") as HTMLElement;
    expect(fill).toHaveStyle({ width: "50%" });
    expect(fill).toHaveAttribute("data-tone", "critical");
    expect(fill.closest(".m-bar-track")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("N").closest("th")).toHaveStyle({ width: "120px" });
  });

  it("barFill maps value to pct and step, and null for non-numbers", () => {
    expect(barFill(95, { max: 100, tone: "rate" })?.attr["data-tone"]).toBe("pass");
    expect(barFill(100, { max: 100 })?.attr["data-step"]).toBe(5);
    expect(barFill(null, { max: 100 })).toBeNull();
  });

  it("keeps the header and shows one message row with an action when empty", () => {
    render(<DataTable columns={columns} data={[]} getRowId={(r: Row) => r.id} emptyMessage="Nothing yet" emptyAction={<button type="button">Add one</button>} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add one" })).toBeInTheDocument();
  });

  it("hides the built-in search with hideSearch and bounds the scroll box with maxHeight", () => {
    const { container } = render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} hideSearch hideToolbar maxHeight={300} />);
    expect(screen.queryByLabelText("Filter rows")).not.toBeInTheDocument();
    expect(container.querySelector("div[style*='max-height: 300px']")).not.toBeNull();
  });

  it("right-aligns a sortable numeric header with its figures", () => {
    interface N { id: string; n: number }
    render(<DataTable columns={[numberColumn<N>("n", "Count")]} data={[{ id: "a", n: 3 }]} getRowId={(r) => r.id} hideToolbar />);
    const button = screen.getByRole("button", { name: "Count" });
    expect(button).toHaveClass("w-full", "justify-end");
    expect(button.closest("th")).toHaveClass("text-right");
  });

  it("pins sticky columns, hides low-priority columns on phones and draws the row action in one style", () => {
    const cols = [
      { ...textColumn<Row>("name", "Name"), meta: { sticky: "start" } satisfies CellMeta },
      { ...idColumn<Row>("id", "Key"), meta: { mono: true, priority: "low" } satisfies CellMeta },
      actionColumn<Row>((r) => <RowAction href={`/x/${r.id}`} label={`Open ${r.name}`} />),
    ];
    render(<DataTable columns={cols} data={rows} getRowId={(r) => r.id} hideToolbar />);
    const head = screen.getAllByRole("columnheader");
    expect(head[0]).toHaveClass("sticky", "left-0");
    expect(head[1]).toHaveClass("max-[640px]:hidden");
    expect(head[2]).toHaveClass("sticky", "right-0");
    const open = screen.getByRole("link", { name: "Open Alpha" });
    expect(open).toHaveAttribute("href", "/x/1");
    expect(open.className).toBe(ROW_ACTION_CLASS);
    const cell = open.closest("td");
    expect(cell).toHaveClass("sticky", "right-0", "bg-[var(--m-sheet)]", "whitespace-nowrap");
    expect(open).toHaveClass("whitespace-nowrap");
  });

  it("pins a plain action column to the right edge on one line, so a phone never clips Open to Ope", () => {
    const cols = [
      textColumn<Row>("name", "Name"),
      { id: "action", header: "", cell: ({ row }: { row: { original: Row } }) => <a href={`/x/${row.original.id}`}>Open</a> },
    ];
    render(<DataTable columns={cols} data={rows} getRowId={(r) => r.id} hideToolbar />);
    const head = screen.getAllByRole("columnheader");
    expect(head[1]).toHaveClass("sticky", "right-0", "whitespace-nowrap");
    const cell = screen.getAllByRole("link", { name: "Open" })[0].closest("td");
    expect(cell).toHaveClass("sticky", "right-0", "whitespace-nowrap", "bg-[var(--m-sheet)]");
    // An ordinary column is never pinned.
    expect(head[0]).not.toHaveClass("sticky");
  });
});
