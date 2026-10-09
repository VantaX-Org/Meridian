// frontend/design/shell/Rail.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let pathname = "/systems";
const searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "a@b.com", name: "A", role: "admin", permissions: ["approve", "apply", "assign", "upload", "view", "manage_users"] } }),
}));

vi.mock("@/context/licence-context", () => ({
  useLicence: () => ({ isMenuItemEnabled: () => true, isModuleEnabled: () => true, isFeatureEnabled: () => true, manifest: null, isLoading: false }),
}));

vi.mock("@/lib/api/shell", () => ({
  getShellCounts: vi.fn().mockResolvedValue({ fix: 3, inbox: 0 }),
}));

vi.mock("@/lib/api/connectivity", () => ({
  getSystems: vi.fn().mockResolvedValue([]),
}));

import { Rail } from "./Rail";

function renderRail() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Rail />
    </QueryClientProvider>,
  );
}

describe("Rail", () => {
  beforeEach(() => {
    pathname = "/systems";
    window.localStorage.clear();
  });

  it("marks exactly one nav link as the current page", async () => {
    renderRail();
    const current = await screen.findAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Systems");
  });

  it("shows a badge only for an item with a positive live count", async () => {
    renderRail();
    const fix = await screen.findByRole("link", { name: "Fix" });
    expect(await within(fix).findByText("3")).toBeInTheDocument();
    const runs = screen.getByRole("link", { name: "Runs" });
    expect(within(runs).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("every nav href is unique in the flattened rail", async () => {
    renderRail();
    const links = await screen.findAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });

  it("collapses to icon-only rows with no section labels, hiding item text", async () => {
    renderRail();
    const toggle = await screen.findByRole("button", { name: "Collapse navigation" });
    toggle.click();
    expect(await screen.findByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
    expect(screen.queryByText("Systems")).not.toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
    // the link is still reachable by its accessible name even with the text node hidden
    expect(screen.getByRole("link", { name: "Systems" })).toBeInTheDocument();
  });

  it("persists the collapsed state to localStorage and restores it on remount", async () => {
    const { unmount } = renderRail();
    const toggle = await screen.findByRole("button", { name: "Collapse navigation" });
    toggle.click();
    expect(window.localStorage.getItem("meridian:rail")).toBe("collapsed");
    unmount();

    renderRail();
    expect(await screen.findByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
  });
});
