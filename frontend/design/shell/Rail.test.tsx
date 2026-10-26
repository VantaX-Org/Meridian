// frontend/design/shell/Rail.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let pathname = "/systems";
let searchParams = new URLSearchParams("");
let role = "admin";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.com", name: "A", role, permissions: ["approve", "apply", "assign", "upload", "view", "manage_users", "manage_settings", "view_audit"] } }),
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

  it.each(["admin", "platform_admin", "programme_lead", "data_steward", "data_owner", "sap_basis", "analyst", "viewer", "auditor", "steward", "manager"])(
    "%s: keeps Fix as a pill and shows a Processes pill, with Discovery runs and the designer under More",
    async (r) => {
      role = r;
      renderRail();
      expect(await screen.findByRole("link", { name: "Processes" })).toHaveAttribute("href", "/process");
      expect(screen.getByRole("link", { name: /^Fix work/ })).toBeInTheDocument();
      const pills = [...screen.getByTestId("rail-nav-items").children].filter((li) => li.querySelector("a"));
      expect(pills.length).toBeLessThanOrEqual(MAX_PILLS);
      fireEvent.click(screen.getByRole("button", { name: "More" }));
      const panel = screen.getByRole("group", { name: "More pages" });
      expect(panel).toHaveTextContent("Discovery runs");
      expect(panel).toHaveTextContent("Process designer");
      expect(panel).not.toHaveTextContent("As-is processes");
    },
  );

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

  it("shows the six main entries as pills, in order, and everything else under More", async () => {
    renderRail();
    await screen.findByRole("link", { name: "Objects" });
    const pills = [...screen.getByTestId("rail-nav-items").children].map((li) => li.textContent?.replace(/\d+$/, "").trim());
    expect(pills).toEqual(["Fix work", "Objects", "Runs", "Processes", "Progress", "Inbox"]);
    // More sits in the Main nav but outside the scrolling pill strip, so it never scrolls out of reach.
    const more = screen.getByRole("button", { name: "More" });
    expect(screen.getByTestId("rail-nav-items")).not.toContainElement(more);
    expect(screen.getByRole("navigation", { name: "Main" })).toContainElement(more);
    fireEvent.click(more);
    const panel = screen.getByRole("group", { name: "More pages" });
    for (const section of ["Analysis", "Master data", "Rules", "Data in", "Admin"]) expect(panel).toHaveTextContent(section);
    expect(panel).toHaveTextContent("Systems");
    // Runs is a pill now, so More does not list it twice; All features leads the panel.
    expect(within(panel).queryByRole("link", { name: "Runs" })).toBeNull();
    expect(within(panel).getAllByRole("link")[0]).toHaveAttribute("href", "/features");
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

  it("a Fix count of cleaning proposals opens the Cleaning tab as a neutral count", async () => {
    vi.mocked(getShellCounts).mockResolvedValueOnce({ fix: 4, fix_source: "cleaning", inbox: 0 });
    renderRail();
    const badge = await screen.findByText("4");
    const fix = badge.closest("a");
    expect(fix).toHaveAttribute("href", "/fix?tab=cleaning");
    expect(badge.closest("[data-severity='critical']")).toBeNull();
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
});
