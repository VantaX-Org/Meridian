import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { render, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as mig from "@/lib/api/v2/migration";
import { Guide } from "../screens/Guide";
import { PairedQuality } from "../screens/PairedQuality";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/s4");
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
});

describe("Guide", () => {
  it("renders the lede, the one filled action and the glossary", () => {
    render(<Guide shows="Shows things" next={{ href: "/runs", label: "Go" }} means={[["Figure", "Meaning"]]} />);
    expect(screen.getByText("Shows things")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Go" })).toHaveLength(1);
    expect(screen.getByText("Meaning")).toBeTruthy();
    expect(screen.queryByTestId("system-chip")).toBeNull();
  });
  it("names the system and marks it inactive", () => {
    render(<Guide shows="x" system="Alpha" inactive />);
    expect(screen.getByTestId("system-chip").textContent).toMatch(/Alpha/);
    expect(screen.getByTestId("system-chip").textContent).toMatch(/Inactive/);
  });
  it("shows no action or glossary when none is given", () => {
    render(<Guide shows="x" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });
});

describe("PairedQuality states", () => {
  it("is empty when no analysis finished", async () => {
    vi.spyOn(mig, "getMigrationRuns").mockResolvedValue({ runs: [] } as never);
    renderWithQuery(<PairedQuality />);
    expect(await screen.findByText(/No migration analysis has finished yet/)).toBeTruthy();
  });
  it("says why when the run has no reconciliation", async () => {
    vi.spyOn(mig, "getMigrationRuns").mockResolvedValue({ runs: [{ id: "r1", status: "analysed" }] } as never);
    vi.spyOn(mig, "getReconciliation").mockResolvedValue({ scores: [] } as never);
    renderWithQuery(<PairedQuality />);
    expect(await screen.findByText(/not been reconciled/)).toBeTruthy();
  });
  it("shows an error with a retry", async () => {
    vi.spyOn(mig, "getMigrationRuns").mockRejectedValue(new Error("boom"));
    renderWithQuery(<PairedQuality />);
    expect(await screen.findByText(/could not be read/, undefined, { timeout: 8000 })).toBeTruthy();
  });
});
