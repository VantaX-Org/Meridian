/**
 * Meridian's own Aletheia engine sidecar (api/routes/aletheia_engine.py).
 *
 *   GET /aletheia/engine            whether the engine is configured and reachable, its version, licence verdict and usage
 *   GET /insights/engine-drivers    normal ranges and lead/lag links the engine learned from the run trend
 *
 * Both answer when the engine is off; the body says why. Only run-level scores and counts reach the engine.
 */
import { v2Get } from "./client";

export interface EngineLicence {
  valid: boolean;
  /** False when no licence key is set: the engine then runs unlicensed. */
  licensed: boolean;
  reason: string | null;
  deployment: string | null;
  expires: string | null;
  max_tenants: number | null;
}

export interface EngineStatus {
  configured: boolean;
  live: boolean;
  token_set: boolean;
  tenant: string;
  version: string | null;
  licence: EngineLicence | null;
  usage: { counters?: Record<string, number>; events?: number; first_seen?: string | number | null; last_seen?: string | number | null } | null;
}

export type EngineOffReason = "too_few_runs" | "not_configured" | "unreachable" | "no_token" | "licence_invalid" | "engine_error";

export interface EngineRange { metric: string; mean: number | null; low: number | null; high: number | null; n: number | null; latest: number | null; outside: boolean }
export interface EngineLink { source: string; target: string; lag: number | null; correlation: number | null }

export interface EngineDrivers {
  labels: Record<string, string>;
  available: boolean;
  reason?: EngineOffReason;
  runs?: number;
  ranges?: EngineRange[];
  links?: EngineLink[];
}

export const getEngineStatus = () => v2Get<EngineStatus>("/aletheia/engine");
export const getEngineDrivers = () => v2Get<EngineDrivers>("/insights/engine-drivers", { limit: 12 });
