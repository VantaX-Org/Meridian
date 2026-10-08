import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { DataTable } from "./DataTable";
import { textColumn } from "./columns";

afterEach(cleanup);

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
    fireEvent.change(screen.getByPlaceholderText("Filter..."), { target: { value: "Bravo" } });
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
});
