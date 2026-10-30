import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { updateContract } from "@/lib/api/v2/roles";
import { RelatedObjects } from "../../screens/object/Related";
import { mount, norm, reset, visit } from "./helpers";

vi.mock("next/navigation", async () => (await import("../nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => reset());
afterEach(() => vi.restoreAllMocks());

describe("the data owner's jobs", () => {
  it("sees on a batch that they cover for someone who is out of office", async () => {
    visit("/work?open=batch:B-241", "data_owner");
    mount();
    expect(norm(await screen.findByTestId("delegation-banner"))).toBe("You cover for T. Mokoena until 30 Oct 2026: their approvals and assigned work come to you as well.");
  });

  it("reads a contract's breaches and versions, and cannot revise it without manage_rules", async () => {
    visit("/people?open=contract:ct-1", "data_owner");
    mount();
    expect(norm(await screen.findByTestId("contract-breaches"))).toContain("1 promise not met");
    expect(norm(screen.getByTestId("contract-versions"))).toContain("Raised the bar for mock load 2");
    expect(screen.queryByRole("button", { name: "Revise as a new version" })).toBeNull();
  });

  it("approves a contract waiting for approval, never their own (four eyes)", async () => {
    await updateContract("ct-2", { status: "pending_approval" });
    visit("/people?open=contract:ct-2", "data_owner");
    mount();
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", "Four eyes: you wrote it");
  });

  it("reads the escalation chain but cannot change it", async () => {
    visit("/work?open=triage", "data_owner");
    mount();
    const chain = await screen.findByTestId("escalation-chain");
    await waitFor(() => expect(norm(chain)).toContain("4 hours past due: the team lead"));
    expect(norm(chain)).toContain("Changing the chain needs the manage triage permission.");
    expect(within(chain).queryByRole("button", { name: "Save the chain" })).toBeNull();
  });

  it("applies the steward template to their own object from the object canvas", async () => {
    visit("/o/ecc-production/material-master", "data_owner");
    mount(<RelatedObjects module="material_master" system="ecc-production" systemId="a1b2c3d4-0001-4000-8000-000000000001" label="Material master" />);
    const apply = await screen.findByTestId("owner-apply");
    fireEvent.click(within(apply).getByRole("button", { name: "Steward template" }));
    expect(norm(await within(apply).findByText(/^The template would add/))).toContain("0 and change 0");
  });

  it("cannot balance work: it needs the assign permission", async () => {
    visit("/people?open=balance", "data_owner");
    mount();
    expect(norm(await screen.findByTestId("needs-permission"))).toBe("Balancing work needs the assign permission.");
  });
});
