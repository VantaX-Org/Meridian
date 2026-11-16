import type { ComponentType } from "react";
import { ApiKeys } from "./access/ApiKeys";
import { Licence } from "./access/Licence";
import { Llm } from "./access/Llm";
import { Notify } from "./access/Notify";
import { Roles } from "./access/Roles";
import { Scoring } from "./access/Scoring";
import { Settings } from "./access/Settings";
import { SignIn } from "./access/SignIn";
import { Users } from "./access/Users";
import { Webhooks } from "./access/Webhooks";
import { OPS_SECTIONS } from "./ops";
import { t } from "@/lib/v2/i18n";

/** One page under /n/admin/[section]. Labels are functions so t() runs at render time, in the viewer's language. */
export interface AdminSection {
  slug: string;
  label: () => string;
  group: () => string;
  lead: () => string;
  /** Legacy permission names; holding any one opens the section. */
  needs: readonly string[];
  Screen: ComponentType;
}

const people = () => t("People and access");
const tenant = () => t("Tenant");
const notify = () => t("Notifications");
const ops = () => t("Data and operations");
const comply = () => t("Compliance");

export const SECTIONS: Record<string, AdminSection> = {
  // 11a
  users: { slug: "users", label: () => t("Users"), group: people, lead: () => t("Who can sign in, with which roles, and where each invitation stands."), needs: ["manage_users"], Screen: Users },
  roles: { slug: "roles", label: () => t("Roles and permissions"), group: people, lead: () => t("What each role may do. Built-in roles are fixed; copy one to change it."), needs: ["manage_users"], Screen: Roles },
  apikeys: { slug: "apikeys", label: () => t("API keys"), group: people, lead: () => t("Keys for scripts and other systems, each with its own roles."), needs: ["manage_users"], Screen: ApiKeys },
  signin: { slug: "signin", label: () => t("Sign-in and SCIM"), group: people, lead: () => t("Single sign-on with your identity provider, and automatic user provisioning."), needs: ["manage_users"], Screen: SignIn },
  settings: { slug: "settings", label: () => t("Settings"), group: tenant, lead: () => t("The tenant, effort planning, alert thresholds and the cost model."), needs: ["manage_settings", "view"], Screen: Settings },
  scoring: { slug: "scoring", label: () => t("Scoring"), group: tenant, lead: () => t("How the quality score is weighted, and the bands each dimension is judged by."), needs: ["manage_settings", "view"], Screen: Scoring },
  licence: { slug: "licence", label: () => t("Licence"), group: tenant, lead: () => t("What this deployment is licensed for: modules, seats and validity."), needs: ["view", "manage_system", "manage_settings", "manage_users"], Screen: Licence },
  notify: { slug: "notify", label: () => t("Notifications"), group: notify, lead: () => t("Where alerts and digests are sent, and what you receive yourself."), needs: ["manage_settings", "view"], Screen: Notify },
  webhooks: { slug: "webhooks", label: () => t("Webhooks"), group: notify, lead: () => t("Signed events to any https endpoint, and the delivery log."), needs: ["manage_settings"], Screen: Webhooks },
  llm: { slug: "llm", label: () => t("Language model"), group: notify, lead: () => t("Which model answers Aletheia, and whether it sees only aggregates."), needs: ["manage_llm"], Screen: Llm },
  // 11b
  data: { slug: "data", label: () => t("Data retention"), group: ops, lead: () => t("How long runs, reports and audit entries are kept."), needs: ["manage_settings"], Screen: OPS_SECTIONS["data"] },
  mappings: { slug: "mappings", label: () => t("Field mappings"), group: ops, lead: () => t("Your field names against the standard fields."), needs: ["manage_field_mappings"], Screen: OPS_SECTIONS["mappings"] },
  schedules: { slug: "schedules", label: () => t("Extraction schedules"), group: ops, lead: () => t("When each system is pulled again on its own."), needs: ["manage_systems", "view"], Screen: OPS_SECTIONS["schedules"] },
  "external-db": { slug: "external-db", label: () => t("External databases"), group: ops, lead: () => t("Database connections loaded as a source."), needs: ["manage_systems"], Screen: OPS_SECTIONS["external-db"] },
  triage: { slug: "triage", label: () => t("Triage settings"), group: ops, lead: () => t("Time to resolve by severity, teams and assignment rules."), needs: ["manage_settings", "view"], Screen: OPS_SECTIONS["triage"] },
  engine: { slug: "engine", label: () => t("Aletheia engine"), group: ops, lead: () => t("Whether the engine is live, and its version."), needs: ["view"], Screen: OPS_SECTIONS["engine"] },
  system: { slug: "system", label: () => t("System"), group: ops, lead: () => t("Health checks, version and support bundle."), needs: ["manage_system", "view"], Screen: OPS_SECTIONS["system"] },
  billing: { slug: "billing", label: () => t("Billing"), group: ops, lead: () => t("Exception billing by tier for one month."), needs: ["manage_settings"], Screen: OPS_SECTIONS["billing"] },
  access: { slug: "access", label: () => t("Access requests"), group: comply, lead: () => t("Requests for more access, waiting for a decision."), needs: ["manage_users"], Screen: OPS_SECTIONS["access"] },
  audit: { slug: "audit", label: () => t("Audit log"), group: comply, lead: () => t("Who changed what, and when, with export."), needs: ["view_audit", "manage_users"], Screen: OPS_SECTIONS["audit"] },
  "subject-requests": { slug: "subject-requests", label: () => t("Data subject requests"), group: comply, lead: () => t("Find, export or erase one person's data, with the request ledger."), needs: ["manage_settings"], Screen: OPS_SECTIONS["subject-requests"] },
  "contact-verify": { slug: "contact-verify", label: () => t("Contact verification"), group: comply, lead: () => t("Checks on email, phone and address values."), needs: ["manage_settings", "view"], Screen: OPS_SECTIONS["contact-verify"] },
  enterprise: { slug: "enterprise", label: () => t("Enterprise"), group: comply, lead: () => t("Status page, branding, compliance and provisioning."), needs: ["manage_settings"], Screen: OPS_SECTIONS["enterprise"] },
};

export const isSection = (slug: string): boolean => Object.prototype.hasOwnProperty.call(SECTIONS, slug);
