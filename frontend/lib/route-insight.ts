// Builds the four InsightHeader cells for a route from facts the API already returns.
// Pure: no fetching here, so every sentence is testable and every number traces to a field.
import type { InsightHeaderProps } from "@/design";
import { formatMoney } from "@/lib/format";

export interface InsightFacts {
  hasRun: boolean;
  runId?: string;
  /** findings/aggregate dqs.composite and previous_dqs */
  dqs: number | null;
  prevDqs: number | null;
  critical: number;
  total: number;
  affected: number;
  /** findings/aggregate cost_at_risk, when the tenant has a cost rate configured */
  costAtRisk?: number;
  /** Tenant currency code for `costAtRisk`; plain digits when unknown. */
  currency?: string;
  /** True when no earlier run exists in this run's lineage (same system, or same upload objects): there is nothing to compare with. */
  firstRun?: boolean;
  /** versions/compare delta between the latest run and its baseline: objects whose score moved */
  moved?: { count: number; biggest?: { label: string; change: number }; href: string };
  worst?: { module: string; label: string; findings: number; critical: number };
  systems: number;
  waves: number;
  /** stewardship/metrics backlog_total */
  backlog: number | null;
  /** useDayOne step while no run is finished */
  /** `status` marks a step that only reports progress (analysis running): the cell links, but no button is shown. */
  dayOne?: { label: string; href: string | null; status?: boolean };
  /** Runs still extracting or analysing; shown instead of the fresh-install copy. */
  running?: number;
}

const n = (x: number) => x.toLocaleString("en-US");
const tone = (dqs: number | null): "go" | "at-risk" | "no-go" | "neutral" =>
  dqs === null ? "neutral" : dqs >= 85 ? "go" : dqs >= 60 ? "at-risk" : "no-go";
const q = (runId?: string) => (runId ? `?run=${runId}` : "");

export type Section =
  | "home" | "objects" | "runs" | "rules" | "insights" | "mdm" | "inbox" | "fix"
  | "import" | "admin" | "migration" | "systems" | "search";

export function sectionOf(pathname: string): Section | null {
  const seg = pathname.split("/")[1] as Section | undefined;
  if (!seg || seg === ("design" as string)) return null;
  const known: Section[] = ["home", "objects", "runs", "rules", "insights", "mdm", "inbox", "fix", "import", "admin", "migration", "systems", "search"];
  return known.includes(seg) ? seg : null;
}

/**
 * The shell banner belongs on the persona homes only. `/insights` carries its own four-sentence
 * header (InsightFrame), and every other page starts with its own title.
 */
export function showsRouteInsight(pathname: string): boolean {
  return pathname === "/home" || pathname.startsWith("/home/");
}

const FRESH: Record<Section, string> = {
  home: "Nothing has been analysed yet, so there is no score to show.",
  objects: "Objects appear here once the first run has finished.",
  runs: "No runs yet. Each analysis you start is listed here with its score.",
  rules: "Rules are ready and will be evaluated on the first run.",
  insights: "Insights come from a finished run, and there is none yet.",
  mdm: "Golden records appear once a run has found duplicates to match.",
  inbox: "Your inbox is empty. Items arrive when a run finds records to steward.",
  fix: "No fix batches yet. Batches are built from findings that have a safe correction.",
  import: "No file has been imported yet.",
  admin: "Settings are at their defaults until you change them.",
  migration: "No migration waves yet. A wave groups the objects you move together.",
  systems: "No SAP system is connected yet.",
  search: "Search covers findings, rules and records once a run has finished.",
};

const FRESH_WHY: Record<Section, string> = {
  home: "Until a run has finished, nobody can say whether this data is ready for go-live.",
  objects: "Object health drives which data blocks go-live.",
  runs: "Run history is how you prove the score is improving.",
  rules: "Rule coverage decides what gets checked at all.",
  insights: "Readiness and value at risk need a score to start from.",
  mdm: "Duplicates inflate cost and break reporting after migration.",
  inbox: "Stewardship queues keep fixes owned and auditable.",
  fix: "Reviewed fixes are the only way findings leave the backlog.",
  import: "An import gives Meridian data to analyse without a live connection.",
  admin: "Thresholds and weights change what counts as ready.",
  migration: "Waves turn the score into a go or no-go per object.",
  systems: "Every finding traces back to a system you connect.",
  search: "One search finds the record, the rule and the finding behind it.",
};

export function buildInsight(section: Section, f: InsightFacts): Omit<InsightHeaderProps, "aiSummary" | "loading"> {
  if (!f.hasRun) {
    const step = f.dayOne;
    const next = step
      ? { sentence: step.label, href: step.href ?? undefined, action: step.href && !step.status ? { label: step.label, href: step.href } : undefined }
      : { sentence: "Connect a system or import a file to start.", href: "/systems" };
    const running = f.running ?? 0;
    const situation = running > 0
      ? { sentence: `Analysis is running for ${n(running)} run${running === 1 ? "" : "s"}. The score appears here when it finishes.`, href: "/runs" }
      : { sentence: FRESH[section], href: "/systems" };
    return {
      situation,
      changed: { sentence: "Nothing has changed yet. Change shows once a second run has finished.", href: "/runs" },
      why: { sentence: FRESH_WHY[section], href: "/home" },
      next,
    };
  }

  const dqs = f.dqs;
  const delta = dqs !== null && f.prevDqs !== null ? Math.round((dqs - f.prevDqs) * 10) / 10 : null;
  const base = `/objects${q(f.runId)}`;
  const worst = f.worst;
  const score = dqs === null ? "This run has no score yet" : `Quality is at ${Math.round(dqs)}`;

  let situation = `${score}, with ${n(f.total)} findings across ${n(f.affected)} records.`;
  if (section === "systems") situation = `${n(f.systems)} system${f.systems === 1 ? "" : "s"} connected. ${score}.`;
  if (section === "migration") situation = `${n(f.waves)} migration wave${f.waves === 1 ? "" : "s"} defined. ${score}.`;
  if ((section === "inbox" || section === "mdm") && f.backlog !== null) situation = `${n(f.backlog)} item${f.backlog === 1 ? "" : "s"} waiting for a steward. ${score}.`;

  const mv = f.moved;
  const moves = mv && mv.count > 0 ? `${n(mv.count)} object${mv.count === 1 ? "" : "s"} moved${mv.biggest ? `; biggest: ${mv.biggest.label} ${mv.biggest.change > 0 ? "+" : "-"}${Math.abs(mv.biggest.change)}` : ""}.` : null;
  const scoreChanged =
    f.firstRun
      ? "This is the first run of this object, so there is nothing to compare with yet."
      : delta === null
      ? "There is no earlier run to compare with yet."
      : delta === 0
        ? "Nothing has moved since the last run."
        : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} points since the last run.`;

  const changed = moves ? (delta === null || delta === 0 ? moves : `${scoreChanged.replace(/ since the last run\.$/, "")}; ${moves}`) : scoreChanged;

  const why =
    f.critical > 0
      ? `${n(f.critical)} critical finding${f.critical === 1 ? " is" : "s are"} capping the score and could stop go-live.`
      : f.total > 0
        ? "Nothing critical, so nothing caps the score."
        : "This run found nothing wrong.";

  // Held until the cost model names the currency, so the sentence never reads as a bare number.
  const risk = f.costAtRisk != null && f.costAtRisk > 0 && f.currency ? ` About ${formatMoney(Math.round(f.costAtRisk), f.currency)} is at risk.` : "";
  // On the homes the verdict's action is the one next step (it picks the lowest-scoring object, this cell the most
  // findings), so this cell links its object but offers no second button.
  const next =
    worst && f.total > 0
      ? {
          sentence: `${worst.label} needs the most work: ${n(worst.findings)} findings${worst.critical ? `, ${n(worst.critical)} of them critical` : ""}.`,
          href: `/objects/${worst.module}${q(f.runId)}`,
          ...(section === "home" ? {} : { action: { label: "Open object", href: `/objects/${worst.module}${q(f.runId)}` } }),
        }
      : { sentence: "Have a look over the objects; nothing stands out.", href: base };

  return {
    situation: { sentence: situation, href: f.runId ? `/runs/${f.runId}` : "/runs", tone: tone(dqs) },
    changed: { sentence: changed, href: mv?.href ?? "/runs", tone: delta === null || delta === 0 ? "neutral" : delta > 0 ? "go" : "no-go" },
    why: { sentence: why + risk, href: `/objects${q(f.runId)}${f.critical > 0 ? `${f.runId ? "&" : "?"}severity=critical` : ""}`, tone: f.critical > 0 ? "no-go" : "neutral" },
    next,
  };
}
