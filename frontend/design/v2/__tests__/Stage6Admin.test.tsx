import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import * as rolesApi from "@/lib/api/v2/roles";
import * as matchApi from "@/lib/api/v2/match-rules";
import { DelegationsSection } from "../admin/capabilities";
import { MatchRulesSection } from "../admin/matchrules";
import { DqFirewallSection } from "../admin/dqfirewall";
import { WorkflowsSection } from "../admin/workflows";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  undo = stubLayout();
  setUrl("/admin");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Admin sections: failed read and the one filled action", () => {
  it("out of office: a failed read says so and offers a retry", async () => {
    vi.spyOn(rolesApi, "getAllDelegations").mockRejectedValue(new Error("boom"));
    renderWithQuery(<DelegationsSection />);
    expect(await screen.findByText(/The delegations could not be read/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("match rules: a failed read says so; the page keeps one filled primary", async () => {
    vi.spyOn(matchApi, "listMatchRules").mockRejectedValue(new Error("boom"));
    const { container } = renderWithQuery(<MatchRulesSection />);
    expect(await screen.findByText(/The match rules could not be read/)).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll(".m2-btn.m2-next").length).toBe(1));
  });

  it("firewall: the check is the single filled action", async () => {
    const { container } = renderWithQuery(<DqFirewallSection />);
    const b = await screen.findByRole("button", { name: "Check records" });
    expect(b.className).toContain("m2-next");
    expect(container.querySelectorAll(".m2-btn.m2-next").length).toBe(1);
  });

  it("workflows: a new workflow is the filled action on the list", async () => {
    renderWithQuery(<WorkflowsSection />);
    const b = await screen.findByRole("button", { name: "New workflow" });
    expect(b.className).toContain("m2-next");
    fireEvent.click(b);
  });
});
