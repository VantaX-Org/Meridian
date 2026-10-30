import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { mount, norm, reset, visit } from "./helpers";

vi.mock("next/navigation", async () => (await import("../nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const ECC = landscapeFixture.systems[0];
beforeEach(() => {
  reset();
  resetRunsFixture();
});
afterEach(() => vi.restoreAllMocks());

async function pick(role: string) {
  visit(`/?open=system:${ECC.id}`, role);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Extract" }));
  const picker = await screen.findByTestId("extract-picker");
  const list = await within(picker).findByRole("list", { name: "Objects to extract" });
  fireEvent.click(within(list).getByRole("checkbox", { name: /Material master/ }));
  return picker;
}

describe("the SAP Basis jobs", () => {
  it("dry-runs an extraction: tables, last row counts and how long it would take, reading nothing", async () => {
    const picker = await pick("sap_basis");
    const dry = within(picker).getByTestId("dry-run");
    fireEvent.click(within(dry).getByRole("button", { name: "Dry run" }));
    const plan = await within(dry).findByTestId("dry-run-plan");
    expect(norm(plan)).toContain("512,346 rows in 5 tables, about 2 minutes (this system's recent speed, 4,211 rows a second).");
    expect(within(plan).getByRole("rowheader", { name: "MARA" })).toBeInTheDocument();
  });

  it("starts a delta extraction when the last download allows one", async () => {
    const picker = await pick("sap_basis");
    const dry = within(picker).getByTestId("dry-run");
    fireEvent.click(within(dry).getByRole("button", { name: "Dry run" }));
    const plan = await within(dry).findByTestId("dry-run-plan");
    fireEvent.click(within(plan).getByRole("button", { name: "Extract changes only" }));
    expect(await within(plan).findByText(/^Delta extraction queued/)).toBeInTheDocument();
  });

  it("a viewer sees the dry run but cannot start it", async () => {
    visit(`/?open=system:${ECC.id}`, "viewer");
    mount();
    expect(await screen.findByTestId("inspector")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dry run" })).toBeNull();
  });
});
