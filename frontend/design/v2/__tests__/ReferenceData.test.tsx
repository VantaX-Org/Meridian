import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resetReferenceData } from "@/lib/api/v2/fixtures/reference-data";
import { renderWithQuery } from "@/__tests__/render";
import { ReferenceData } from "../screens/ReferenceData";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
const go = (list: string) => { const u = `/reference-data?fixture=1&persona=owner&list=${list}`; window.history.pushState({}, "", u); setUrl(u); };
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  resetReferenceData();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("reference data", () => {
  it("shows the lists with coverage and each code beside its description", async () => {
    go("payment_terms");
    renderWithQuery(<ReferenceData />);
    expect(await screen.findByTestId("reference-data")).toBeInTheDocument();
    expect(within(screen.getByTestId("ref-lists")).getByTestId("ref-list-payment_terms")).toBeInTheDocument();
    const row = await screen.findByTestId("ref-code-Z045");
    expect(within(row).getAllByText(/45 days net/).length).toBeGreaterThan(0);
    expect(within(row).getByText("Approved")).toBeInTheDocument();
  });

  it("lets a steward propose a mapping, which waits for a second person", async () => {
    go("unit_of_measure");
    renderWithQuery(<ReferenceData />);
    const form = await screen.findByTestId("ref-propose");
    fireEvent.change(within(form).getByLabelText("Source code"), { target: { value: "Z02" } });
    fireEvent.change(within(form).getByLabelText("Target code"), { target: { value: "M" } });
    fireEvent.click(within(form).getByRole("button", { name: "Propose" }));
    const row = await screen.findByTestId("ref-map-Z02");
    expect(within(row).getByText("Waiting for approval")).toBeInTheDocument();
  });

  it("refuses approval by the proposer", async () => {
    go("payment_terms");
    renderWithQuery(<ReferenceData />);
    const row = await screen.findByTestId("ref-map-Z060");
    fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
    expect(await within(row).findByRole("alert")).toBeInTheDocument();
    expect(within(row).getByText("Waiting for approval")).toBeInTheDocument();
  });

  it("lets a different person approve", async () => {
    go("country");
    renderWithQuery(<ReferenceData />);
    const row = await screen.findByTestId("ref-map-UK");
    fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(within(screen.getByTestId("ref-map-UK")).getByText("Approved")).toBeInTheDocument());
  });

  it("suggests a proved target on request", async () => {
    go("unit_of_measure");
    renderWithQuery(<ReferenceData />);
    const form = await screen.findByTestId("ref-propose");
    fireEvent.change(within(form).getByLabelText("Source code"), { target: { value: "Z01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Ask Aletheia" }));
    expect(await screen.findByTestId("ref-suggestion")).toHaveTextContent("PC");
  });
});
