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

const ALL = ["view", "manage_rules", "manage_field_mappings", "manage_llm", "manage_settings", "manage_system", "assign", "manage_users", "view_audit", "trigger_sync", "analyse"];

describe("Admin tab strip", () => {
  beforeEach(() => { pathname = "/admin/settings"; perms = new Set(ALL); });

  it("lists Overview, Users, Roles and access, Sign-in, Alerts, Triage, Field mapping, Reference data, Jobs, Audit log, Billing and Licence, marking the current one", () => {
    pathname = "/admin/triage";
    render(<SettingsTabs />);
    const nav = screen.getByRole("navigation", { name: "Admin pages" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/admin/settings", "/admin/users", "/admin/roles", "/admin/sign-in", "/admin/alerts", "/admin/triage", "/admin/mappings",
      "/admin/reference", "/admin/jobs", "/admin/audit", "/admin/billing", "/admin/licence",
    ]);
    expect(links.map((a) => a.textContent)).toEqual([
      "Overview", "Users", "Roles and access", "Sign-in", "Alerts", "Triage", "Field mapping",
      "Reference data", "Jobs", "Audit log", "Billing", "Licence",
    ]);
    expect(links[0]).toHaveTextContent("Overview");
    expect(within(nav).getByRole("link", { current: "page" })).toHaveTextContent("Triage");
  });

  it("is the same strip on every admin page, only the current tab changes", () => {
    const strip = (path: string) => {
      pathname = path;
      const { unmount } = render(<SettingsTabs />);
      const links = within(screen.getByRole("navigation", { name: "Admin pages" })).getAllByRole("link");
      const out = { hrefs: links.map((a) => a.getAttribute("href")), current: links.find((a) => a.getAttribute("aria-current") === "page")?.textContent };
      unmount();
      return out;
    };
    const users = strip("/admin/users");
    expect(users.current).toBe("Users");
    for (const [path, tab] of [["/admin/roles", "Roles and access"], ["/admin/audit", "Audit log"], ["/admin/jobs", "Jobs"], ["/admin/billing", "Billing"], ["/admin/settings", "Overview"]]) {
      const here = strip(path!);
      expect(here.hrefs).toEqual(users.hrefs);
      expect(here.current).toBe(tab);
    }
  });

  it("offers only the admin pages the role may open", () => {
    perms = new Set(["view", "manage_field_mappings", "manage_settings"]);
    render(<SettingsTabs />);
    const labels = within(screen.getByRole("navigation", { name: "Admin pages" })).getAllByRole("link").map((a) => a.textContent);
    expect(labels).toContain("Field mapping");
    expect(labels).not.toContain("Users");
    expect(labels).not.toContain("Roles and access");
    expect(labels).not.toContain("Sign-in");
  });

  it("shows no strip to a role that can open only one admin page", () => {
    perms = new Set(["view", "trigger_sync"]);
    const { container } = render(<SettingsTabs />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the role cannot see Settings", () => {
    perms = new Set(["view"]);
    const { container } = render(<SettingsTabs />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reaches every admin page: Users, Roles and access and Audit log stay in More, Jobs stays under Data in", () => {
    const tabs = settingsTabs(visibleNav(gate())).map((t) => t.href);
    for (const h of ["/admin/users", "/admin/roles", "/admin/audit", "/admin/jobs"]) expect(tabs).toContain(h);
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
