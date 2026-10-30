import { DensityContext } from "@/lib/v2/density";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Grid, type GridColumn } from "../Grid";
import { gridRegistry } from "@/lib/v2/keys";
import { stubLayout } from "./layout-stub";

interface Row {
  id: string;
  name: string;
  failing: number;
}

const COLUMNS: GridColumn<Row>[] = [
  { id: "id", header: "Rule", width: 120, pin: true, locked: true, cell: (r) => r.id },
  { id: "name", header: "Name", width: 240, cell: (r) => r.name },
  { id: "failing", header: "Failing", width: 100, numeric: true, cell: (r) => r.failing.toLocaleString("en-US") },
];

const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `R${String(i + 1).padStart(6, "0")}`, name: `Rule ${i + 1}`, failing: (i * 37) % 5000 }));

let undo: () => void = () => undefined;

beforeEach(() => {
  window.localStorage.clear();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
  gridRegistry.set(null);
});

const dataRows = () => screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex") !== "1");

describe("<Grid> virtualisation", () => {
  it("renders 100,000 rows in under 200 ms and draws only the rows in view", () => {
    const rows = makeRows(100_000);
    // Best of three: the first render pays for module warm-up, and a loaded host can stall any single one.
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const t0 = performance.now();
      const mounted = render(<Grid id="bench" ariaLabel="Bench" columns={COLUMNS} rows={rows} rowId={(r) => r.id} />);
      best = Math.min(best, performance.now() - t0);
      if (attempt < 2) mounted.unmount();
    }
    expect(best).toBeLessThan(200);
    const drawn = dataRows();
    expect(drawn.length).toBeGreaterThan(10);
    expect(drawn.length).toBeLessThan(60);
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-rowcount", "100001");
    expect(within(drawn[0]).getByText("R000001")).toBeInTheDocument();
    expect(screen.getByText("100,000 rows")).toBeInTheDocument();
  });

  it("places rows on the 36 pixel pitch (28 compact) so scrolling never moves the layout around them", () => {
    const rows = makeRows(5_000);
    const { rerender } = render(<Grid id="pitch" ariaLabel="Pitch" columns={COLUMNS} rows={rows} rowId={(r) => r.id} />);
    const pitch = (h: number) => {
      const drawn = dataRows();
      drawn.forEach((row) => {
        const i = Number(row.getAttribute("aria-rowindex")) - 2;
        expect((row as HTMLElement).style.transform).toBe(`translateY(${i * h}px)`);
        expect((row as HTMLElement).style.height).toBe(`${h}px`);
      });
    };
    pitch(36);
    const body = () => (document.querySelector(".m2-gbody") as HTMLElement).style.height;
    expect(body()).toBe(`${5_000 * 36}px`);
    const scroller = screen.getByRole("grid");
    act(() => {
      scroller.scrollTop = 36 * 2_000;
      fireEvent.scroll(scroller);
    });
    expect(body()).toBe(`${5_000 * 36}px`);
    pitch(36);
    expect(dataRows().some((r) => r.getAttribute("aria-rowindex") === "2002")).toBe(true);
    rerender(<Grid id="pitch" ariaLabel="Pitch" columns={COLUMNS} rows={rows} rowId={(r) => r.id} compact />);
    expect(body()).toBe(`${5_000 * 28}px`);
  });

  it("keeps the header and the first column pinned, and right-aligns numbers", () => {
    render(<Grid id="pin" ariaLabel="Pin" columns={COLUMNS} rows={makeRows(20)} rowId={(r) => r.id} />);
    const head = document.querySelector(".m2-ghead") as HTMLElement;
    expect(head).not.toBeNull();
    expect(within(head).getByText("Rule").closest(".m2-gcell")).toHaveClass("m2-gpin");
    expect(within(head).getByText("Failing").closest(".m2-gcell")).toHaveClass("m2-gnum");
    const first = dataRows()[1];
    expect(within(first).getByText("R000002").closest(".m2-gcell")).toHaveClass("m2-gpin");
    expect(within(first).getByText("R000002").closest(".m2-gcell")).toHaveStyle({ left: "0px" });
    expect(within(first).getByText("37").closest(".m2-gcell")).toHaveClass("m2-gnum");
  });
});

describe("<Grid> keyboard", () => {
  it("j and k move the active row, Enter opens it, x selects it, Shift extends", () => {
    const onOpen = vi.fn();
    render(<Grid id="keys" ariaLabel="Keys" columns={COLUMNS} rows={makeRows(50)} rowId={(r) => r.id} selectable onOpen={onOpen} bulkBar={({ selected }) => <span>{`${selected.length} in the bar`}</span>} />);
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "j" });
    const active = () => document.querySelector('[data-active="true"]')?.getAttribute("aria-rowindex");
    expect(active()).toBe("3"); // focus put it on row 1, j moved to row 2 (aria-rowindex counts the header)
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(active()).toBe("4");
    fireEvent.keyDown(grid, { key: "k" });
    expect(active()).toBe("3");
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "R000002" }));
    fireEvent.keyDown(grid, { key: "x" });
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("1 selected");
    expect(screen.getByText("1 in the bar")).toBeInTheDocument();
    fireEvent.keyDown(grid, { key: "J", shiftKey: true });
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("2 selected");
    fireEvent.keyDown(grid, { key: "Escape" });
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("clamps at the first and last row", () => {
    render(<Grid id="clamp" ariaLabel="Clamp" columns={COLUMNS} rows={makeRows(3)} rowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    grid.focus();
    for (let i = 0; i < 6; i++) fireEvent.keyDown(grid, { key: "j" });
    expect(document.querySelector('[data-active="true"]')?.getAttribute("aria-rowindex")).toBe("4");
    for (let i = 0; i < 6; i++) fireEvent.keyDown(grid, { key: "k" });
    expect(document.querySelector('[data-active="true"]')?.getAttribute("aria-rowindex")).toBe("2");
  });

  it("registers as the page's grid so j and k work from the page", () => {
    render(<Grid id="reg" ariaLabel="Reg" columns={COLUMNS} rows={makeRows(10)} rowId={(r) => r.id} />);
    const target = gridRegistry.get();
    expect(target).not.toBeNull();
    act(() => target?.move(1, false));
    expect(document.querySelector('[data-active="true"]')?.getAttribute("aria-rowindex")).toBe("2");
  });

  it("a click opens the row and the checkbox selects with Shift for a range", () => {
    const onOpen = vi.fn();
    render(<Grid id="click" ariaLabel="Click" columns={COLUMNS} rows={makeRows(10)} rowId={(r) => r.id} selectable onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Rule 3"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "R000003" }));
    fireEvent.click(screen.getByLabelText("Select row 2"));
    fireEvent.click(screen.getByLabelText("Select row 5"), { shiftKey: true });
    expect(screen.getByTestId("bulk-bar")).toHaveTextContent("4 selected");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });
});

describe("<Grid> column chooser", () => {
  const choose = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));
  };

  it("hides a column from the menu, keeps the menu open, and remembers the choice per table", () => {
    const { unmount } = render(<Grid id="chooser" ariaLabel="Chooser" columns={COLUMNS} rows={makeRows(5)} rowId={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    choose("Name");
    expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(window.localStorage.getItem("m2:cols:chooser")).toBe(JSON.stringify(["name"]));
    // The pinned first column is not offered.
    expect(screen.queryByRole("menuitemcheckbox", { name: "Rule" })).toBeNull();
    unmount();
    render(<Grid id="chooser" ariaLabel="Chooser" columns={COLUMNS} rows={makeRows(5)} rowId={(r) => r.id} />);
    expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Failing" })).toBeInTheDocument();
  });

  it("another table's choice is separate", () => {
    window.localStorage.setItem("m2:cols:other", JSON.stringify(["failing"]));
    render(<Grid id="chooser2" ariaLabel="Chooser" columns={COLUMNS} rows={makeRows(5)} rowId={(r) => r.id} />);
    expect(screen.getByRole("columnheader", { name: "Failing" })).toBeInTheDocument();
  });

  it("still works when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Grid id="blocked" ariaLabel="Blocked" columns={COLUMNS} rows={makeRows(5)} rowId={(r) => r.id} />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    choose("Name");
    expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
  });

  it("starts with the columns a definition hides by default", () => {
    const cols: GridColumn<Row>[] = [...COLUMNS, { id: "extra", header: "Extra", width: 80, defaultHidden: true, cell: () => "x" }];
    render(<Grid id="defaults" ariaLabel="Defaults" columns={cols} rows={makeRows(3)} rowId={(r) => r.id} />);
    expect(screen.queryByRole("columnheader", { name: "Extra" })).toBeNull();
    choose("Extra");
    expect(screen.getByRole("columnheader", { name: "Extra" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Show all columns" }));
  });
});

describe("<Grid> states", () => {
  it("shows the empty frame in place of rows and keeps the header", () => {
    render(<Grid id="empty" ariaLabel="Empty" columns={COLUMNS} rows={[]} rowId={(r) => r.id} emptyFrame={<p>No rules yet. Run an analysis.</p>} />);
    expect(screen.getByText("No rules yet. Run an analysis.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Rule" })).toBeInTheDocument();
    expect(screen.getByText("0 rows")).toBeInTheDocument();
  });

  it("shows the error frame in place of rows", () => {
    render(<Grid id="err" ariaLabel="Err" columns={COLUMNS} rows={makeRows(3)} rowId={(r) => r.id} error={<p role="alert">The rules could not be read.</p>} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The rules could not be read.");
    expect(screen.queryByText("R000001")).toBeNull();
  });

  it("follows the density of the shell unless told otherwise", () => {
    const rows = makeRows(10);
    const { unmount } = render(
      <DensityContext.Provider value="compact">
        <Grid id="dens" ariaLabel="Density" columns={COLUMNS} rows={rows} rowId={(r) => r.id} />
      </DensityContext.Provider>,
    );
    expect((dataRows()[0] as HTMLElement).style.height).toBe("28px");
    expect(screen.getByTestId("grid")).toHaveAttribute("data-density", "compact");
    unmount();
    render(
      <DensityContext.Provider value="compact">
        <Grid id="dens" ariaLabel="Density" columns={COLUMNS} rows={rows} rowId={(r) => r.id} compact={false} />
      </DensityContext.Provider>,
    );
    expect((dataRows()[0] as HTMLElement).style.height).toBe("36px");
    expect(screen.getByTestId("grid")).toHaveAttribute("data-density", "comfortable");
  });

  it("shows flat placeholder rows while loading, at the row pitch, filling the frame the rows will have", () => {
    render(<Grid id="load" ariaLabel="Load" columns={COLUMNS} rows={[]} rowId={(r) => r.id} loading height={290} />);
    expect(document.querySelectorAll(".m2-grow-skel")).toHaveLength(7); // (290 - 32 header - 2 rules) / 36 per row
    expect(document.querySelector(".m2-gbody")).toHaveAttribute("aria-busy", "true");
  });

  it("hides the bar when the caller states the count", () => {
    render(<Grid id="nobar" ariaLabel="No bar" columns={COLUMNS} rows={makeRows(3)} rowId={(r) => r.id} hideBar />);
    expect(screen.queryByRole("button", { name: "Choose columns" })).toBeNull();
    expect(screen.queryByText("3 rows")).toBeNull();
  });
});
