import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { rolesAudit } from "@/lib/api/v2/fixtures/roles";
import { AdminCanvas, AdminHome } from "../../admin/Admin";
import { mount, norm, reset, visit } from "./helpers";

vi.mock("next/navigation", async () => (await import("../nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  reset();
  visit("/admin", "platform_admin");
});
afterEach(() => vi.restoreAllMocks());

const file = (input: HTMLElement, name: string, text: string) => {
  const f = new File([text], name, { type: "application/json" });
  Object.defineProperty(f, "text", { value: () => Promise.resolve(text) });
  fireEvent.change(input, { target: { files: [f] } });
};

describe("the admin's jobs", () => {
  it("finds every new administration section on the Admin home", async () => {
    mount(<AdminHome />);
    for (const name of ["Stewardship", "Configuration bundle", "View as a role", "Share links", "Out of office", "Rules import and export"]) {
      expect(await screen.findByRole("link", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });

  it("views as a role: the bar says so, the Admin area closes, and Stop gives the admin back", async () => {
    mount(<AdminCanvas section="viewas" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Role" }), { target: { value: "data_steward" } });
    fireEvent.click(screen.getByRole("button", { name: "View as this role" }));
    const banner = await screen.findByTestId("view-as-banner");
    expect(norm(banner)).toContain("Viewing as Data steward.");
    expect(rolesAudit().map((a) => a.action)).toContain("view_as.start");
    fireEvent.click(within(banner).getByRole("button", { name: "Stop viewing as" }));
    await waitFor(() => expect(screen.queryByTestId("view-as-banner")).toBeNull());
    expect(rolesAudit().map((a) => a.action)).toContain("view_as.stop");
  });

  it("imports a configuration bundle after a dry-run diff", async () => {
    mount(<AdminCanvas section="configbundle" />);
    file(await screen.findByLabelText("Bundle file"), "bundle.json", JSON.stringify({ format: "meridian.tenant-config", version: 1, sections: {} }));
    const diff = await screen.findByTestId("bundle-diff");
    expect(norm(diff)).toContain("3 to add, 2 to change, 15 the same, 3 kept as they are.");
    expect(within(diff).getByText("Wave 4: warehouse")).toBeInTheDocument();
    fireEvent.click(within(diff).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(rolesAudit().map((a) => a.action)).toContain("config_bundle.import"));
  });

  it("edits the steward template, checks the diff, applies it, and reads the gaps", async () => {
    mount(<AdminCanvas section="stewardship" />);
    const table = await screen.findByTestId("template-table");
    const steward = within(table).getByRole("combobox", { name: "Steward of Business partner" });
    await waitFor(() => expect(within(steward).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(steward, { target: { value: "u-an" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the template" }));
    await screen.findByText("Template saved.");
    fireEvent.click(screen.getByRole("button", { name: "Check what applying does" }));
    const diff = await screen.findByTestId("template-diff");
    expect(norm(diff)).toContain("Add: business partner, Steward");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText(/^Applied: 1 added/);
    const gaps = await screen.findByTestId("template-gaps");
    expect(norm(gaps)).toContain("No owner");
  });

  it("revokes a share link", async () => {
    mount(<AdminCanvas section="sharelinks" />);
    const list = await screen.findByTestId("share-links");
    fireEvent.click(within(list).getAllByRole("button", { name: "Revoke" })[0]);
    await waitFor(() => expect(rolesAudit().map((a) => a.action)).toContain("share_link.revoke"));
  });

  it("imports rules in bulk: a check first, then drafts", async () => {
    mount(<AdminCanvas section="rulesio" />);
    file(await screen.findByLabelText("Rules file (YAML)"), "rules.yaml", "- module: material_master\n  id: ZMM901\n");
    await waitFor(() => expect(screen.getByRole("button", { name: "Check the file" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    expect(norm(await screen.findByTestId("bulk-result"))).toContain("2 of 2 rules are valid.");
    fireEvent.click(screen.getByRole("button", { name: "Create 2 drafts" }));
    await waitFor(() => expect(norm(screen.getByTestId("bulk-result"))).toContain("2 drafts created"));
  });

  it("sees everyone's out of office", async () => {
    mount(<AdminCanvas section="delegations" />);
    expect(norm(await screen.findByTestId("all-delegations"))).toContain("T. Mokoena to Demo user");
  });
});
