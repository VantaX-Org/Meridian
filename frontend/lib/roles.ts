// frontend/lib/roles.ts
import type { UserRole } from "@/types/api";

/** Every role a user can hold, in the order the admin pickers list them. */
export const ROLES: UserRole[] = [
  "admin", "manager", "steward", "ai_reviewer", "approver", "analyst", "viewer", "auditor", "process_analyst",
  "programme_lead", "data_steward", "data_owner", "sap_basis", "platform_admin",
];

/** The plain name and one-line description of each role: the one place a role key becomes words. */
export const ROLE_META: Record<UserRole, { label: string; desc: string }> = {
  admin: { label: "Admin", desc: "Full access. Manage users and rules, approve proposed rules." },
  manager: { label: "Manager", desc: "Run the programme. Connect systems, sync, analyse, approve, apply and assign work." },
  steward: { label: "Steward", desc: "Own the data. Fix, clean, approve and apply, maintain rules and assign work." },
  ai_reviewer: { label: "AI Reviewer", desc: "Review and approve proposed rules from steward corrections." },
  approver: { label: "Approver", desc: "Four-eyes approval of cleaning, golden records and stewardship changes." },
  analyst: { label: "Analyst", desc: "Upload, sync and run analysis; export results. No approvals." },
  viewer: { label: "Viewer", desc: "Read-only access to dashboards and findings." },
  auditor: { label: "Auditor", desc: "Read-only access including the audit log." },
  process_analyst: { label: "Process analyst", desc: "Read everything, run process discovery and export as-is process models." },
  // Persona keys (rbac.py PERSONA_ROLES): each carries the actions of the legacy role it replaces.
  programme_lead: { label: "Programme lead / CIO", desc: "Same access as Manager. Lands on the lead home." },
  data_steward: { label: "Data steward", desc: "Same access as Steward. Lands on the steward home." },
  data_owner: { label: "Data owner / approver", desc: "Same access as Approver. Lands on the steward home." },
  sap_basis: { label: "SAP Basis / integration admin", desc: "Analyst access plus connecting systems, sync and field mapping. Lands on the basis home." },
  platform_admin: { label: "Platform admin", desc: "Same access as Admin, including platform updates." },
};

/** A role's plain name; an unknown key is sentence-cased rather than shown raw ("new_role" reads "New role"). */
export function roleLabel(role: string): string {
  const meta = (ROLE_META as Record<string, { label: string } | undefined>)[role];
  if (meta) return meta.label;
  const words = role.replace(/_/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : role;
}
