/**
 * MDM health fixture: 90 daily aggregate snapshots ending on 30 Oct 2026, shaped like api/routes/mdm_metrics.py. The
 * shares are fractions and each health score is computed from them with the weights of api/services/mdm_scoring.py,
 * so the screen's breakdown adds up to the score. The worker writes no AI fields, so they stay null.
 */
import type { MdmSnapshot } from "../mdm-health";

export const NONE_MDM_HEALTH = Symbol("not an MDM health path");

const DAYS = 90;
const END = Date.UTC(2026, 9, 30);
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

function day(i: number): MdmSnapshot {
  const k = i / (DAYS - 1);
  const wobble = Math.sin(i * 0.9) * 0.004;
  const coverage = r4(0.712 + 0.118 * k + wobble);
  const match = r4(0.861 + 0.032 * k - wobble / 2);
  const sla = r4(0.78 + 0.13 * k + Math.cos(i * 0.7) * 0.012);
  const consistency = r4(0.904 + 0.021 * k);
  const score = (coverage * 0.4 + match * 0.3 + sla * 0.2 + consistency * 0.1) * 100;
  return {
    snapshot_date: new Date(END - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    domain: null,
    golden_record_count: Math.round(38_400 + 9_100 * k),
    golden_record_coverage_pct: coverage,
    avg_match_confidence: match,
    steward_sla_compliance_pct: sla,
    source_consistency_pct: consistency,
    mdm_health_score: Math.round(score * 100) / 100,
    backlog_count: Math.round(1_840 - 1_120 * k + Math.sin(i * 0.5) * 40),
    sync_coverage_pct: r4(0.67 + 0.16 * k),
    ai_narrative: null,
    ai_projected_score: null,
    ai_risk_flags: null,
  };
}

const series = () => Array.from({ length: DAYS }, (_, i) => day(i));

export function mdmHealthRead(path: string): unknown {
  if (path === "/mdm-metrics") {
    const all = series();
    return { latest: all[all.length - 1], trend: all.slice(-28), active_systems_count: 3 };
  }
  if (path === "/mdm-metrics/history") return { history: series() };
  return NONE_MDM_HEALTH;
}
