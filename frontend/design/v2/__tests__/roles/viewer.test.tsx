import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getShareMode } from "@/lib/v2/view-as";
import { ReportsCanvas } from "../../screens/Reports";
import { PeopleCanvas } from "../../screens/People";
import { ShareLanding } from "../../shell/RoleBanners";
import { getUrl } from "../nav-store";
import { mount, norm, reset, visit } from "./helpers";

vi.mock("next/navigation", async () => (await import("../nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => reset());
afterEach(() => vi.restoreAllMocks());

const RECORD = "material_master:MATNR=000000000000000100";

describe("the viewer's and the auditor's jobs", () => {
  it("opens a share link: the page it points at, under a read-only shared view", async () => {
    visit("/share/fx-token", "viewer");
    mount(<ShareLanding />);
    await waitFor(() => expect(getShareMode()).toBe("Material master rules for the audit"));
    await waitFor(() => expect(getUrl()).toContain("/o/ecc-production/material-master?tab=rules"));
    expect(await screen.findByTestId("shared-banner")).toHaveTextContent("Shared view. Read-only, as a viewer.");
  });

  it("in a shared view nothing offers a change: Watch is off and comments are read-only", async () => {
    visit(`/work?open=${encodeURIComponent(`record:${RECORD}`)}`, "auditor");
    window.sessionStorage.setItem("mn_v2_share_mode", "Shared view");
    mount();
    const comments = await screen.findByTestId("comments");
    expect(within(comments).queryByRole("textbox")).toBeNull();
    expect(norm(comments)).toContain("This is a shared, read-only view.");
    expect(within(screen.getByTestId("watch")).getByRole("button", { name: "Watch" })).toBeDisabled();
  });

  it("an expired link says so", async () => {
    visit("/share/expired", "viewer");
    mount(<ShareLanding />);
    expect(await screen.findByText("This link was expired. Ask whoever shared it for a new one.")).toBeInTheDocument();
  });

  it("a viewer cannot export a grid; an auditor can", async () => {
    visit("/reports", "viewer");
    const v = mount(<ReportsCanvas />);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Share and export/ }))[0]);
    expect(await screen.findByRole("menuitem", { name: /Export to Excel/ })).toHaveAttribute("aria-disabled", "true");
    v.unmount();
    visit("/reports", "auditor");
    mount(<ReportsCanvas />);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Share and export/ }))[0]);
    expect(await screen.findByRole("menuitem", { name: /Export to Excel/ })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("reads someone's activity only with view_audit: the auditor can, the viewer cannot", async () => {
    visit("/people?open=person:u-an", "viewer");
    const v = mount(<PeopleCanvas />);
    expect(norm(await screen.findByTestId("activity"))).toContain("needs the view audit permission");
    v.unmount();
    visit("/people?open=person:u-an", "auditor");
    mount(<PeopleCanvas />);
    await waitFor(() => expect(norm(screen.getByTestId("activity"))).toContain("decide"));
  });

  it("a viewer sees Data contracts on People but not Balance work", async () => {
    visit("/people", "viewer");
    mount(<PeopleCanvas />);
    const actions = await screen.findByTestId("people-actions");
    expect(within(actions).getByRole("link", { name: "Data contracts" })).toBeInTheDocument();
    expect(within(actions).queryByRole("link", { name: "Balance work" })).toBeNull();
  });
});
