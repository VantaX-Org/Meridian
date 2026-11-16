import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/catalogue";
import { DataCatalogue } from "../Catalogue";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => { setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Data catalogue (native)", () => {
  it("lists the fixture tables with the description beside each table code", async () => {
    renderWithQuery(<DataCatalogue />);
    const tables = await screen.findByTestId("catalogue-tables");
    expect(within(tables).getAllByText("MARA").length).toBeGreaterThan(0);
    expect(within(tables).getByLabelText("MARA")).toHaveTextContent(/General Material Data/i);
  });

  it("opens a table and then a field in the inspector", async () => {
    renderWithQuery(<DataCatalogue />);
    fireEvent.click(within(await screen.findByTestId("catalogue-tables")).getByLabelText("MARA"));
    await waitFor(() => expect(getUrl()).toContain("table=MARA"));
    const fields = await screen.findByTestId("catalogue-fields");
    fireEvent.click(within(fields).getByLabelText("MATNR"));
    await waitFor(() => expect(getUrl()).toContain("open=field"));
  });

  it("says the role cannot read the catalogue on 403", async () => {
    vi.spyOn(api, "getCatalogueTables").mockRejectedValue({ response: { status: 403 } });
    renderWithQuery(<DataCatalogue />);
    expect(await screen.findByText("Your role cannot read the data catalogue.")).toBeInTheDocument();
  });
});
