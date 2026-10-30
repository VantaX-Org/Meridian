import { t } from "@/lib/v2/i18n";
/** The sections of the Admin canvas, in the order the left index lists them, with the permission each one needs. */
export type AdminSlug = "users" | "roles" | "sso" | "signin" | "apikeys" | "licence" | "billing" | "settings" | "mappings" | "reference" | "audit" | "alerts" | "notifications" | "webhooks" | "runs" | "system" | Step10Slug | CapabilitySlug;
/** Step 10: policy packs and scheduled digests. */
export type Step10Slug = "policypacks" | "digests";
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
  { slug: "users", get label() { return t("Users"); }, get group() { return t("People and access"); }, get lead() { return t("Who can sign in, with which roles, and where each invitation stands."); }, needs: ["manage_users"] },
  { slug: "roles", get label() { return t("Roles and permissions"); }, get group() { return t("People and access"); }, get lead() { return t("What each role may do. Built-in roles are fixed; copy one to change it."); }, needs: ["manage_users"] },
  { slug: "sso", get label() { return t("Single sign-on"); }, get group() { return t("People and access"); }, get lead() { return t("OpenID Connect with your identity provider."); }, needs: ["manage_users"] },
  { slug: "signin", get label() { return t("Sign-in page"); }, get group() { return t("People and access"); }, get lead() { return t("What the sign-in page offers, who may use it, and the fixed password rules."); }, needs: ["manage_users"] },
  { slug: "viewas", get label() { return t("View as a role"); }, get group() { return t("People and access"); }, get lead() { return t("See the product as one role sees it, read-only, for support."); }, needs: ["manage_users"] },
  { slug: "sharelinks", get label() { return t("Share links"); }, get group() { return t("People and access"); }, get lead() { return t("Read-only links to a page: who shared what, until when, and revoke."); }, needs: ["manage_users"] },
  { slug: "delegations", get label() { return t("Out of office"); }, get group() { return t("People and access"); }, get lead() { return t("Who is away and who covers their approvals."); }, needs: ["manage_users"] },
  { slug: "apikeys", get label() { return t("API keys"); }, get group() { return t("People and access"); }, get lead() { return t("Keys for scripts and other systems, each with its own roles."); }, needs: ["manage_users"] },
  { slug: "licence", get label() { return t("Licence"); }, get group() { return t("Tenant"); }, get lead() { return t("What this deployment is licensed for: modules, seats and validity."); }, needs: ["view", "manage_system", "manage_settings", "manage_users"] },
  { slug: "billing", get label() { return t("Billing"); }, get group() { return t("Tenant"); }, get lead() { return t("Resolved exceptions by billing tier, on top of the base fee."); }, needs: ["manage_settings"] },
  { slug: "settings", get label() { return t("Settings"); }, get group() { return t("Tenant"); }, get lead() { return t("Scoring, the cost model, tolerance and how long data is kept."); }, needs: ["manage_settings", "view"] },
  { slug: "stewardship", get label() { return t("Stewardship"); }, get group() { return t("Tenant"); }, get lead() { return t("The steward assignment template: one owner per object, stewards per slice, and the gaps."); }, needs: ["manage_settings"] },
  { slug: "configbundle", get label() { return t("Configuration bundle"); }, get group() { return t("Tenant"); }, get lead() { return t("Export the tenant's configuration as one file, and import one with a diff first."); }, needs: ["manage_settings"] },
  { slug: "mappings", get label() { return t("Field mappings"); }, get group() { return t("Data"); }, get lead() { return t("Which column in your files holds each standard SAP field."); }, needs: ["manage_field_mappings", "manage_settings", "view"] },
  { slug: "reference", get label() { return t("Reference data"); }, get group() { return t("Data"); }, get lead() { return t("Postal code and bank code lists that address and bank rules compare against."); }, needs: ["manage_systems", "manage_settings", "view"] },
  { slug: "rulesio", get label() { return t("Rules import and export"); }, get group() { return t("Data"); }, get lead() { return t("Every rule as YAML or Excel, and many rules back in as drafts."); }, needs: ["manage_rules", "export"] },
  { slug: "policypacks", get label() { return t("Policy packs"); }, get group() { return t("Data"); }, get lead() { return t("GxP, SOX and GDPR field classes, the authority each answers to, and the rules that evidence them."); }, needs: ["manage_rules", "view"] },
  { slug: "audit", get label() { return t("Audit log"); }, get group() { return t("Data"); }, get lead() { return t("Every change made through the product, by whom and when."); }, needs: ["view_audit", "manage_users"] },
  { slug: "alerts", get label() { return t("Alerts"); }, get group() { return t("Notifications"); }, get lead() { return t("When an alert fires and which channels carry it."); }, needs: ["manage_settings", "view"] },
  { slug: "notifications", get label() { return t("Default digest"); }, get group() { return t("Notifications"); }, get lead() { return t("The tenant's default digest."); }, needs: ["manage_settings", "view"] },
  { slug: "webhooks", get label() { return t("Webhooks"); }, get group() { return t("Notifications"); }, get lead() { return t("Signed events to Slack, Teams or any https endpoint, the delivery log, and what runs by itself."); }, needs: ["manage_settings"] },
  { slug: "digests", get label() { return t("Digests"); }, get group() { return t("Notifications"); }, get lead() { return t("Scheduled summaries by role or by wave: the landscape, score moves, gates, approvals and value at risk."); }, needs: ["manage_settings"] },
  { slug: "runs", get label() { return t("Start and schedule"); }, get group() { return t("Operations"); }, get lead() { return t("Start an extraction, an analysis, a configuration load or an upload, and schedule them. The runs themselves are on Runs."); }, needs: ["trigger_sync", "analyse", "manage_systems", "upload"] },
  { slug: "system", get label() { return t("Platform and updates"); }, get group() { return t("Operations"); }, get lead() { return t("Background jobs, the platform version and health checks."); }, needs: ["manage_system", "view"] },
];

export const isAdminSlug = (s: string): s is AdminSlug => ADMIN_SECTIONS.some((x) => x.slug === s);

/** The sections this viewer may open. */
export function visibleSections(can: (action: string) => boolean): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => s.needs.some((n) => can(n)));
}

const ADMIN_ACTIONS = ["manage_users", "manage_settings", "manage_system", "view_audit", "manage_field_mappings", "manage_systems"] as const;

/** True when the viewer holds any administrative permission: that is what puts "Administration" in the account menu. */
export const canAdminister = (can: (action: string) => boolean): boolean => ADMIN_ACTIONS.some((a) => can(a));
