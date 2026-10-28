// frontend/design/shell/Rail.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let pathname = "/systems";
let searchParams = new URLSearchParams("");
let role = "admin";
const ALL_PERMS = ["approve", "apply", "assign", "upload", "view", "manage_users", "manage_settings", "view_audit"];
let perms = ALL_PERMS;

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.com", name: "A", role, permissions: perms } }),
}));

vi.mock("@/context/licence-context", () => ({
  useLicence: () => ({ isMenuItemEnabled: () => true, isModuleEnabled: () => true, isFeatureEnabled: () => true, manifest: null, isLoading: false }),
}));

vi.mock("@/lib/api/shell", () => ({
  getShellCounts: vi.fn().mockResolvedValue({ fix: 3, inbox: 0 }),
}));
import { getShellCounts } from "@/lib/api/shell";

vi.mock("@/lib/api/connectivity", () => ({
  getSystems: vi.fn().mockResolvedValue([]),
}));

import { Rail } from "./Rail";
import { MAX_PILLS } from "../../lib/nav";

function renderRail() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Rail />
    </QueryClientProvider>,
  );
}

describe("Rail (the index bar)", () => {
  beforeEach(() => {
    pathname = "/systems";
    searchParams = new URLSearchParams("");
    role = "admin";
    perms = ALL_PERMS;
  });

  it("folds the Settings tabs under one Settings link and lists Audit log once", async () => {
    renderRail();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    const panel = screen.getByRole("group", { name: "More pages" });
    const labels = [...panel.querySelectorAll("a")].map((a) => a.textContent ?? "");
    expect(labels.filter((l) => l === "Settings")).toHaveLength(1);
    expect(labels.filter((l) => l === "Audit log")).toHaveLength(1);
    for (const tab of ["Triage", "Field mapping", "AI settings", "Licence", "Jobs", "Reference data"]) expect(labels).not.toContain(tab);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/admin/settings");
  });

  it("leads the process persona's strip with Processes, and Fix moves into More", async () => {
    role = "process_analyst";
    renderRail();
    const processes = await screen.findByRole("link", { name: "Processes" });
    expect(processes).toHaveAttribute("href", "/process");
    const strip = screen.getByTestId("rail-nav-items");
    const pills = [...strip.querySelectorAll(":scope > li > a")].map((a) => a.textContent);
    expect(pills[0]).toBe("Processes");
    expect(pills).not.toContain("Fix work3");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const panel = screen.getByRole("group", { name: "More pages" });
    expect(panel).toHaveTextContent("Fix");
    expect(panel).toHaveTextContent("Process designer");
    expect(panel).not.toHaveTextContent("As-is processes");
  });

  const LEAD = ["Home", "Objects", "Fix work", "Inbox", "Progress", "Runs"];
  const STEWARD = ["Fix work", "Inbox", "Objects", "Match review", "Runs", "Progress"];
  const OWNER = ["Approvals", "Inbox", "Objects", "Fix work", "Progress", "Runs"];
  const BASIS = ["Systems", "Jobs", "Runs", "Inbox", "Objects"];
  it.each([
    ["admin", LEAD], ["platform_admin", LEAD], ["programme_lead", LEAD], ["manager", LEAD], ["analyst", LEAD], ["viewer", LEAD], ["auditor", LEAD],
    ["data_steward", STEWARD], ["steward", STEWARD],
    ["data_owner", OWNER], ["approver", OWNER],
    ["sap_basis", BASIS],
  ])("%s: pills by role, with Processes, Discovery runs and the designer under More", async (r, expected) => {
    role = r;
    // trigger_sync opens Jobs; the shared set holds every other permission these pills need
    perms = [...ALL_PERMS, "trigger_sync"];
    renderRail();
    await screen.findByRole("link", { name: "Objects" });
    const pills = [...screen.getByTestId("rail-nav-items").querySelectorAll(":scope > li > a")].map((a) => a.textContent?.replace(/\d+$/, "").trim());
    expect(pills).toEqual(expected);
    expect(pills.length).toBeLessThanOrEqual(MAX_PILLS);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const panel = screen.getByRole("group", { name: "More pages" });
    expect(panel).toHaveTextContent("As-is processes");
    expect(panel).toHaveTextContent("Discovery runs");
    expect(panel).toHaveTextContent("Process designer");
    // no page is both a pill and a More entry (a data owner with view_audit still finds Fix work's batch approvals there)
    const pillHrefs = [...screen.getByTestId("rail-nav-items").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const a of panel.querySelectorAll("a")) expect(pillHrefs).not.toContain(a.getAttribute("href"));
  });

  it("lights only the data owner's Approvals pill on Inbox › Approvals, not Inbox as well", async () => {
    role = "data_owner";
    perms = ["view", "approve"];
    pathname = "/inbox";
    searchParams = new URLSearchParams("kind=approvals");
    renderRail();
    const current = await screen.findAllByRole("link", { current: "page" });
    expect(current.map((a) => a.textContent)).toEqual(["Approvals"]);
    expect(current[0]).toHaveAttribute("href", "/inbox?kind=approvals");
  });

  it("never carries the page's ?run= onto a nav link", async () => {
    pathname = "/objects/material_master";
    searchParams = new URLSearchParams("run=v-old&tab=rules");
    const { container } = renderRail();
    await screen.findByRole("link", { name: "Objects" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(5);
    expect(hrefs.filter((h) => /[?&]run=/.test(h))).toEqual([]);
  });

  it("marks exactly one nav link as the current page", async () => {
    pathname = "/objects";
    renderRail();
    const current = await screen.findAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Objects");
  });

  it("shows the lead's six pills, in order, and everything else under More", async () => {
    renderRail();
    await screen.findByRole("link", { name: "Objects" });
    const pills = [...screen.getByTestId("rail-nav-items").children].map((li) => li.textContent?.replace(/\d+$/, "").trim());
    expect(pills).toEqual(["Home", "Objects", "Fix work", "Inbox", "Progress", "Runs"]);
    // More sits in the Main nav but outside the scrolling pill strip, so it never scrolls out of reach.
    const more = screen.getByRole("button", { name: "More" });
    expect(screen.getByTestId("rail-nav-items")).not.toContainElement(more);
    expect(screen.getByRole("navigation", { name: "Main" })).toContainElement(more);
    fireEvent.click(more);
    const panel = screen.getByRole("group", { name: "More pages" });
    for (const section of ["Analysis", "Master data", "Rules", "Data in", "Admin"]) expect(panel).toHaveTextContent(section);
    expect(panel).toHaveTextContent("Systems");
    // Runs and Home are pills, so More does not list them twice; All features leads the panel, then Processes,
    // the main entry the lead's strip leaves out.
    expect(within(panel).queryByRole("link", { name: "Runs" })).toBeNull();
    expect(within(panel).queryByRole("link", { name: "Home" })).toBeNull();
    expect(within(panel).getAllByRole("link")[0]).toHaveAttribute("href", "/features");
    expect(within(panel).getAllByRole("link")[1]).toHaveAttribute("href", "/process");
    expect(panel).not.toHaveTextContent("Fix work");
  });

  it("the More link for the current page is marked current inside the open panel", async () => {
    renderRail();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Systems");
  });

  it("renders the Fix queue count as a critical badge inside a data-severity element", async () => {
    renderRail();
    const fix = await screen.findByRole("link", { name: /^Fix work/ });
    const badge = await screen.findByText("3");
    expect(fix).toContainElement(badge);
    expect(badge.closest("[data-severity='critical']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Inbox" })).not.toHaveTextContent("0");
  });

  it("hides the Fix badge when no work list is built (the count is null)", async () => {
    vi.mocked(getShellCounts).mockResolvedValueOnce({ fix: null, inbox: 2 });
    renderRail();
    const fix = await screen.findByRole("link", { name: /^Fix work/ });
    await screen.findByText("2");
    expect(fix).not.toHaveTextContent(/\d/);
    expect(fix).toHaveAttribute("href", "/fix");
  });

  it("every nav href is unique across the pills and the More panel", async () => {
    const { container } = renderRail();
    await screen.findByRole("link", { name: "Objects" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const hrefs = [...container.querySelectorAll("nav a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("the More panel opens on click, holds the pages that are not pills, and closes on Escape", async () => {
    renderRail();
    const button = await screen.findByRole("button", { name: "More" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "More pages" })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("group", { name: "More pages" });
    expect(panel).toHaveTextContent("Glossary");
    expect(panel).toHaveTextContent("Rules");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "More pages" })).toBeNull();
  });

  it("renders the More panel outside the sideways-scrolling pill strip, anchored under the button", async () => {
    renderRail();
    const button = await screen.findByRole("button", { name: "More" });
    button.getBoundingClientRect = () => ({ top: 8, bottom: 40, left: 420, right: 480, width: 60, height: 32, x: 420, y: 8, toJSON: () => ({}) });
    fireEvent.click(button);
    const panel = screen.getByRole("group", { name: "More pages" });
    // .m-topnav-nav has overflow-x: auto, which forces overflow-y to clip: a panel inside it never shows.
    expect(panel.closest(".m-topnav-nav")).toBeNull();
    expect(panel.closest("nav")).toBeNull();
    expect(panel.closest("header")).not.toBeNull();
    expect(panel.style.getPropertyValue("--rail-more-top")).toBe("48px");
    expect(panel.style.getPropertyValue("--rail-more-left")).toBe("420px");
    // A click inside the panel keeps it open; a click outside closes it.
    fireEvent.mouseDown(panel);
    expect(screen.getByRole("group", { name: "More pages" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("group", { name: "More pages" })).toBeNull();
  });

  it("the More button reads as active when the current page lives inside it", async () => {
    pathname = "/mdm/glossary";
    renderRail();
    const button = await screen.findByRole("button", { name: "More" });
    expect(button).toHaveAttribute("data-active", "true");
    expect(screen.queryAllByRole("link", { current: "page" })).toHaveLength(0);
  });

  it("names a pill with a health pip from its visible text first, then the health", async () => {
    const { getSystems } = await import("@/lib/api/connectivity");
    vi.mocked(getSystems).mockResolvedValueOnce([{ health_status: "healthy" }, { health_status: "unreachable" }] as never);
    renderRail();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    const link = await screen.findByRole("link", { name: "Systems, 1 of 2 systems healthy" });
    expect(link.getAttribute("aria-label")?.startsWith(link.textContent ?? "")).toBe(true);
  });

  it("brand home link keeps its accessible name", async () => {
    renderRail();
    expect(await screen.findByRole("link", { name: "Meridian" })).toBeInTheDocument();
  });

  it.each(["/admin/settings", "/admin/triage", "/admin/licence", "/admin/billing"])(
    "on Settings tab %s the More button is active and Settings is the current entry in the panel",
    async (path) => {
      pathname = path;
      renderRail();
      const button = await screen.findByRole("button", { name: "More" });
      expect(button).toHaveAttribute("data-active", "true");
      fireEvent.click(button);
      const panel = screen.getByRole("group", { name: "More pages" });
      const current = within(panel).getAllByRole("link", { current: "page" });
      expect(current.map((a) => a.textContent)).toEqual(["Settings"]);
    },
  );

  it.each([
    // A steward who may neither approve nor apply cannot use Fix work: the brand opens the steward home.
    ["data_steward", ["view"], "/home/steward"],
    // A data owner approves but cannot apply: the brand opens Inbox › Approvals, where the requests wait.
    ["data_owner", ["view", "approve"], "/inbox?kind=approvals"],
    ["data_steward", ["view", "approve", "apply"], "/fix"],
    ["admin", ALL_PERMS, "/home/lead"],
  ])("%s with %j: the brand opens %s", async (r, p, href) => {
    role = r;
    perms = p;
    renderRail();
    expect(await screen.findByRole("link", { name: "Meridian" })).toHaveAttribute("href", href);
  });
});
