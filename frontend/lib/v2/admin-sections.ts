/** The sections of the Admin canvas, in the order the left index lists them, with the permission each one needs. */
export type AdminSlug = "users" | "roles" | "sso" | "signin" | "apikeys" | "licence" | "billing" | "settings" | "mappings" | "reference" | "audit" | "alerts" | "notifications" | "runs" | "system" | CapabilitySlug;
/** Step 6c, the role capability audit (design/v2/admin/capabilities.tsx). */
export type CapabilitySlug = "stewardship" | "configbundle" | "viewas" | "rulesio" | "sharelinks" | "delegations";

export interface AdminSection {
  slug: AdminSlug;
  label: string;
  group: string;
  /** One line under the title. */
  lead: string;
  /** The permissions that open it: any one is enough. */
  needs: readonly string[];
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { slug: "users", label: "Users", group: "People and access", lead: "Who can sign in, with which roles, and where each invitation stands.", needs: ["manage_users"] },
  { slug: "roles", label: "Roles and permissions", group: "People and access", lead: "What each role may do. Built-in roles are fixed; copy one to change it.", needs: ["manage_users"] },
  { slug: "sso", label: "Single sign-on", group: "People and access", lead: "OpenID Connect with your identity provider.", needs: ["manage_users"] },
  { slug: "signin", label: "Sign-in page", group: "People and access", lead: "What the sign-in page offers, who may use it, and the fixed password rules.", needs: ["manage_users"] },
  { slug: "viewas", label: "View as a role", group: "People and access", lead: "See the product as one role sees it, read-only, for support.", needs: ["manage_users"] },
  { slug: "sharelinks", label: "Share links", group: "People and access", lead: "Read-only links to a page: who shared what, until when, and revoke.", needs: ["manage_users"] },
  { slug: "delegations", label: "Out of office", group: "People and access", lead: "Who is away and who covers their approvals.", needs: ["manage_users"] },
  { slug: "apikeys", label: "API keys", group: "People and access", lead: "Keys for scripts and other systems, each with its own roles.", needs: ["manage_users"] },
  { slug: "licence", label: "Licence", group: "Tenant", lead: "What this deployment is licensed for: modules, seats and validity.", needs: ["view", "manage_system", "manage_settings", "manage_users"] },
  { slug: "billing", label: "Billing", group: "Tenant", lead: "Resolved exceptions by billing tier, on top of the base fee.", needs: ["manage_settings"] },
  { slug: "settings", label: "Settings", group: "Tenant", lead: "Scoring, the cost model, tolerance and how long data is kept.", needs: ["manage_settings", "view"] },
  { slug: "stewardship", label: "Stewardship", group: "Tenant", lead: "The steward assignment template: one owner per object, stewards per slice, and the gaps.", needs: ["manage_settings"] },
  { slug: "configbundle", label: "Configuration bundle", group: "Tenant", lead: "Export the tenant's configuration as one file, and import one with a diff first.", needs: ["manage_settings"] },
  { slug: "mappings", label: "Field mappings", group: "Data", lead: "Which column in your files holds each standard SAP field.", needs: ["manage_field_mappings", "manage_settings", "view"] },
  { slug: "reference", label: "Reference data", group: "Data", lead: "Postal code and bank code lists that address and bank rules compare against.", needs: ["manage_systems", "manage_settings", "view"] },
  { slug: "rulesio", label: "Rules import and export", group: "Data", lead: "Every rule as YAML or Excel, and many rules back in as drafts.", needs: ["manage_rules", "export"] },
  { slug: "audit", label: "Audit log", group: "Data", lead: "Every change made through the product, by whom and when.", needs: ["view_audit", "manage_users"] },
  { slug: "alerts", label: "Alerts", group: "Notifications", lead: "When an alert fires and which channels carry it.", needs: ["manage_settings", "view"] },
  { slug: "notifications", label: "Notifications", group: "Notifications", lead: "The tenant's default digest.", needs: ["manage_settings", "view"] },
  { slug: "runs", label: "Runs and jobs", group: "Operations", lead: "Start an extraction, an analysis or a configuration load, schedule them, and retry what failed.", needs: ["trigger_sync", "analyse", "manage_systems"] },
  { slug: "system", label: "Jobs and system update", group: "Operations", lead: "Background jobs, the platform version and health checks.", needs: ["manage_system", "view"] },
];

export const isAdminSlug = (s: string): s is AdminSlug => ADMIN_SECTIONS.some((x) => x.slug === s);

/** The sections this viewer may open. */
export function visibleSections(can: (action: string) => boolean): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => s.needs.some((n) => can(n)));
}

const ADMIN_ACTIONS = ["manage_users", "manage_settings", "manage_system", "view_audit", "manage_field_mappings", "manage_systems"] as const;

/** True when the viewer holds any administrative permission: that is what puts "Administration" in the account menu. */
export const canAdminister = (can: (action: string) => boolean): boolean => ADMIN_ACTIONS.some((a) => can(a));
