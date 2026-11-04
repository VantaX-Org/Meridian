/**
 * Aletheia verified survivorship client (api/routes/aletheia_survivorship.py, read only).
 *
 *   GET /aletheia/survivorship     model picks of a golden-record winner, per object counts and the newest picks with their checks
 *
 * The model sees only the shape of each source's value. A pick wins only when the server proved it; no value is returned.
 */
import { v2Get } from "./client";

export interface SurvivorshipCheck { code: string; passed: boolean }

export interface SurvivorshipPick {
  domain: string;
  sap_object_key: string;
  field: string;
  field_text?: string | null;
  recommended_source: string;
  confidence?: number | null;
  reasoning: string;
  verified: boolean;
  checks: SurvivorshipCheck[];
}

export interface Survivorship {
  domains: { domain: string; verified: number; rejected: number }[];
  picks: SurvivorshipPick[];
}

export const getSurvivorship = (): Promise<Survivorship> => v2Get<Survivorship>("/aletheia/survivorship");
