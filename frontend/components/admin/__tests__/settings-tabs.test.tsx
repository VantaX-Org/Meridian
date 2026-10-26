import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsTabs, visibleNav } from "@/lib/nav";
import { railSplit } from "@/design/shell/Rail";
import { SettingsTabs } from "../settings-tabs";

let pathname = "/admin/settings";
let perms = new Set<string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
const gate = () => ({ can: (a: string) => perms.has(a), isMenuItemEnabled: () => true });
vi.mock("@/hooks/use-nav", () => ({ useVisibleNav: () => visibleNav(gate()) }));

const ALL = ["view", "manage_rules", "manage_field_mappings", "manage_llm", "manage_settings", "manage_system", "assign"];

describe("Settings tab strip", () => {
  beforeEach(() => { pathname = "/admin/settings"; perms = new Set(ALL); });

  it("lists the overview and every Settings page, marking the current one", () => {
    pathname = "/admin/triage";
    render(<SettingsTabs />);
    const nav = screen.getByRole("navigation", { name: "Settings pages" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/admin/settings", "/admin/triage", "/admin/mappings", "/admin/ai", "/admin/notifications", "/admin/reference", "/admin/billing", "/admin/licence",
    ]);
    expect(links[0]).toHaveTextContent("Overview");
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("Triage");
  });

  it("offers only the Settings pages the role may open", () => {
    perms = new Set(["view", "manage_field_mappings"]);
    render(<SettingsTabs />);
    const labels = within(screen.getByRole("navigation", { name: "Settings pages" })).getAllByRole("link").map((a) => a.textContent);
    expect(labels).toContain("Field mapping");
    expect(labels).not.toContain("AI settings");
    expect(labels).not.toContain("Triage");
  });

  it("renders nothing when the role cannot see Settings", () => {
    perms = new Set(["view"]);
    const { container } = render(<SettingsTabs />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reaches every Settings child the More menu folds away", () => {
    const groups = visibleNav(gate());
    const tabs = settingsTabs(groups).map((t) => t.href);
    const more = railSplit(groups, "lead").more.flatMap((g) => g.items.map((i) => i.href));
    const settings = groups.flatMap((g) => g.items).find((i) => i.href === "/admin/settings");
    for (const child of settings?.children ?? []) {
      expect(more).not.toContain(child.href);
      expect(tabs).toContain(child.href);
    }
  });
});
