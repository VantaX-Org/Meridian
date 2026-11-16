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
};

export const isSection = (slug: string): boolean => Object.prototype.hasOwnProperty.call(SECTIONS, slug);
