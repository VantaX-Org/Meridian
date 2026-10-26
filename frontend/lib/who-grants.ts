/**
 * Who to ask for an action the viewer lacks: the everyday persona roles that hold it (api/services/rbac.py
 * PERSONA_ROLES), named the way a colleague says them. Admins hold every action and the specialist process analyst
 * is not who a lead or steward asks, so neither is listed. tests/test_who_grants.py keeps each list in step with
 * rbac.py: every role named here holds the action, and every persona that holds it is named or deliberately left out.
 */
export const GRANTED_BY = {
  run_process_discovery: ["programme_lead", "data_steward", "sap_basis"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type GrantedAction = keyof typeof GRANTED_BY;

/** The role as it reads in a sentence ("Ask a data steward"); SAP Basis keeps its product casing. */
const SPOKEN: Readonly<Record<string, string>> = {
  programme_lead: "programme lead",
  data_steward: "data steward",
  sap_basis: "SAP Basis",
};

const list = (names: readonly string[]): string =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

/** "programme lead, data steward or SAP Basis": the roles that grant `action`, joined for a sentence. */
export function whoGrants(action: GrantedAction): string {
  return list(GRANTED_BY[action].map((r) => SPOKEN[r] ?? r.replace(/_/g, " ")));
}

/** "Ask a programme lead, data steward or SAP Basis to run discovery." */
export function askToRun(action: GrantedAction, what: string): string {
  return `Ask a ${whoGrants(action)} to ${what}.`;
}

/** The roles as a tooltip names them, first word capitalised ("Programme lead, data steward or SAP Basis"). */
export function grantingRolesLabel(action: GrantedAction): string {
  const s = whoGrants(action);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
