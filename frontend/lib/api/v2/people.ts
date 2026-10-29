import { v2Get } from "./client";

export interface PersonObject {
  module: string;
  label: string;
  as: "owner" | "steward";
}

/**
 * One row of GET /people. `sla_met_pct` is read when the API sends it (it does not yet); without it the share of open
 * work not yet past its due date is shown, and said so.
 */
export interface Person {
  id: string;
  name: string;
  email: string | null;
  role: string;
  is_me: boolean;
  objects_owned: PersonObject[];
  open_work: number;
  approvals_waiting: number;
  overdue: number;
  sla_hours: number | null;
  breaches_this_month: number;
  last_action_at: string | null;
  sla_met_pct?: number | null;
}

export const getPeople = (): Promise<{ people: Person[] }> => v2Get("/people");
