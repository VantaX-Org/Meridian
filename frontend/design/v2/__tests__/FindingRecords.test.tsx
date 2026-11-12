import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { FindingRecords } from "../screens/FindingRecords";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Finding records", () => {
  it("pages the failing records with field codes and their text", async () => {
    renderWithQuery(<FindingRecords checkId="MM-001" runs={[{ id: "r1", label: "Material master" }]} />);
    const table = await screen.findByTestId("finding-records-table");
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    expect(within(table).getByRole("columnheader", { name: /MTART/ })).toBeInTheDocument();
    expect(screen.getByTestId("finding-records-range")).toHaveTextContent("Records 1 to 25 of 137");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByTestId("finding-records-range")).toHaveTextContent("Records 26 to 50 of 137"));
  });

  it("offers a run choice only when there is more than one run", async () => {
    renderWithQuery(<FindingRecords checkId="MM-001" runs={[{ id: "r1", label: "A" }, { id: "r2", label: "B" }]} />);
    expect(await screen.findByRole("combobox", { name: "Run" })).toBeInTheDocument();
  });

  it("renders nothing without a run", () => {
    renderWithQuery(<FindingRecords checkId="MM-001" runs={[]} />);
    expect(screen.queryByTestId("finding-records")).toBeNull();
  });
});
