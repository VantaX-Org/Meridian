import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { More } from "../../screens/More";
import { ADMIN_FLOWS, isAdminFlow } from "../AdminFlows";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/design/v2/screens/RulePromotion", async () => (await import("../../__tests__/stub")).stub("RulePromotion"));
vi.mock("@/lib/api/roles", () => ({
  listRoles: vi.fn().mockResolvedValue([
    { key: "steward", name: "Steward", legacy: false },
    { key: "old", name: "Old", legacy: true },
  ]),
}));
vi.mock("@/lib/api/licence", () => ({ getLicenceManifest: vi.fn().mockResolvedValue({ enabled_modules: ["material-master"] }) }));

beforeEach(() => setUrl("/more/admin?fixture=1"));

describe("admin flows", () => {
  it("knows the three flows and nothing else", () => {
    expect(ADMIN_FLOWS.every(isAdminFlow)).toBe(true);
    expect(isAdminFlow("users")).toBe(true);
    expect(isAdminFlow("licence")).toBe(false);
  });

  it("the users flow offers the roles the API returns, without legacy ones", async () => {
    renderWithQuery(<More slug={["admin", "flow", "users"]} />);
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByTestId("flow-step-role");
    expect(screen.getByRole("radio", { name: /Steward/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Old/ })).toBeNull();
  });

  it("the connect flow is gated on a name and a host", async () => {
    renderWithQuery(<More slug={["admin", "flow", "connect"]} />);
    await screen.findByLabelText(/^Name/);
    expect(screen.getAllByText("Enter a name and a host.")[0]).toBeTruthy();
  });

  it("the rule flow mounts RulePromotion and holds on the review gate", async () => {
    renderWithQuery(<More slug={["admin", "flow", "rules"]} />);
    expect(screen.getByTestId("mounted")).toHaveTextContent("RulePromotion");
    expect(screen.getAllByText("Confirm that you reviewed the impact.")[0]).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("flow-step-done")).toBeInTheDocument());
  });

  it("the admin page links to the three tasks and keeps the section routes", () => {
    renderWithQuery(<More slug={["admin"]} />);
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.includes("/more/admin/flow/"))).toHaveLength(3);
  });
});
