// frontend/design/shell/Rail.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let pathname = "/systems";
let searchParams = new URLSearchParams("");

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

describe("Rail (the index bar)", () => {
  beforeEach(() => {
    pathname = "/systems";
    searchParams = new URLSearchParams("");
  });

  it("never carries the page's ?run= onto a nav link", async () => {
    pathname = "/objects/material_master";
    searchParams = new URLSearchParams("run=v-old&tab=rules");
    const { container } = renderRail();
    await screen.findByRole("link", { name: "Runs" });
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(5);
    expect(hrefs.filter((h) => /[?&]run=/.test(h))).toEqual([]);
  });

  it("marks exactly one nav link as the current page", async () => {
    renderRail();
    const current = await screen.findAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Systems");
  });

  it("renders the Fix queue count as a critical badge inside a data-severity element", async () => {
    renderRail();
    const fix = await screen.findByRole("link", { name: /^Fix/ });
    const badge = await screen.findByText("3");
    expect(fix).toContainElement(badge);
    expect(badge.closest("[data-severity='critical']")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Inbox" })).not.toHaveTextContent("0");
  });

  it("every nav href is unique across the pills and the More panel", async () => {
    const { container } = renderRail();
    await screen.findByRole("link", { name: "Runs" });
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

  it("the More button reads as active when the current page lives inside it", async () => {
    pathname = "/mdm/glossary";
    renderRail();
    const button = await screen.findByRole("button", { name: "More" });
    expect(button).toHaveAttribute("data-active", "true");
    expect(screen.queryAllByRole("link", { current: "page" })).toHaveLength(0);
  });

  it("brand home link keeps its accessible name", async () => {
    renderRail();
    expect(await screen.findByRole("link", { name: "Meridian" })).toBeInTheDocument();
  });
});
