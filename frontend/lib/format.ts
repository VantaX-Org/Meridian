/** One-decimal rounding, the display precision for every DQS/score number. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The delta shown next to two displayed scores: difference of the already-rounded values, not raw precision. */
export function roundedDelta(before: number, after: number): number {
  return round1(after) - round1(before);
}

/**
 * Display names for every module id the backend scores (checks/rules/<system>/<module>.yaml) or extracts
 * (sap/extraction_registry.py). Wording follows api/routes/sync_trigger.py MODULE_REGISTRY, cased by the object-name
 * convention in DESIGN.md: sentence case, SAP acronyms upper case (FI, MM, SD, HCM, MDG, GRC, WM, BP, CVI, PII, IDoc,
 * S/4HANA), eWMS with its lower-case e, product names as SAP writes them (Concur, Ariba, SuccessFactors), "and" for "&".
 * The backend's copy is api/routes/sync_trigger.py MODULE_LABELS; tests/test_module_labels.py fails when they differ.
 */
export const MODULE_LABELS: Record<string, string> = {
  // ECC and S/4HANA
  business_partner: "Business partner",
  material_master: "Material master",
  fi_gl: "FI general ledger",
  accounts_payable: "Accounts payable",
  accounts_receivable: "Accounts receivable",
  asset_accounting: "Asset accounting",
  controlling: "Controlling",
  hcm: "HCM personnel administration",
  mm_purchasing: "MM purchasing",
  plant_maintenance: "Plant maintenance",
  production_planning: "Production planning",
  project_system: "Project system",
  quality_management: "Quality management",
  sd_customer_master: "SD customer master",
  sd_sales_orders: "SD sales orders",
  interface_health: "Interface health (IDoc)",
  s4_readiness: "S/4HANA readiness",
  banking_tax: "Banking and tax master data",
  s4hc_master_data: "BP roles, CVI and product valuation",
  // SuccessFactors
  employee_central: "Employee central",
  compensation: "Compensation",
  benefits: "Benefits",
  payroll_integration: "Payroll integration",
  performance_goals: "Performance and goals",
  succession_planning: "Succession planning",
  recruiting_onboarding: "Recruiting and onboarding",
  learning_management: "Learning management",
  time_attendance: "Time and attendance",
  // Warehouse
  ewms_stock: "eWMS stock",
  ewms_transfer_orders: "eWMS transfer orders",
  batch_management: "Batch management",
  mdg_master_data: "MDG master data",
  grc_compliance: "GRC compliance",
  fleet_management: "Fleet management",
  transport_management: "Transport management",
  wm_interface: "WM interface",
  cross_system_integration: "Cross-system integration",
  // Concur and Ariba
  concur_expense: "Concur expense reports",
  concur_travel: "Concur travel",
  concur_users: "Concur users and cost objects",
  ariba_supplier: "Ariba suppliers",
  ariba_contracts: "Ariba contracts",
  ariba_procurement: "Ariba purchase orders and invoices",
  ariba_spend: "Ariba spend",
  // Extraction-only and cross-cutting
  process_discovery: "Process discovery",
  process_events_sfx: "SuccessFactors process events",
  process_events_arb: "Ariba process events",
  process_events_cnq: "Concur process events",
  s4_load_sim: "S/4HANA load simulation",
  proven_cost: "Proven cost",
  pii: "PII",
};

/** What each object holds and what it drives, in one or two sentences. Written from the tables Meridian reads for it
 * (sap/extraction_registry.py); an id with no entry has no description. */
export const MODULE_DESCRIPTIONS: Record<string, string> = {
  accounts_payable: "Supplier master data at general and company code level, with account groups, payment terms and payment methods. It determines how and when suppliers are paid.",
  accounts_receivable: "Customer master data at general and company code level, with account groups. It underpins invoicing, credit control and cash collection.",
  asset_accounting: "Fixed asset master records and their depreciation areas. They drive asset valuation and period-end depreciation.",
  business_partner: "The single record for customers, suppliers and contacts: general data, roles, addresses, e-mail and groupings, and on SAP BTP also tax numbers and bank details. It is the foundation of customer-vendor integration in S/4HANA.",
  employee_central: "Core employee data: employment and actions, organisational assignment, personal and contact details, positions, and the picklists they reference. It is the system of record for every downstream HR and payroll process.",
  fi_gl: "The chart of accounts and general ledger accounts at chart and company code level, with document types. It governs how every financial posting is recorded and reported.",
  hcm: "On-premise personnel administration: employee infotypes for actions, assignment, personal data, pay, bank details, addresses and working time, with the organisational structure and its configuration. It feeds payroll, time management and reporting.",
  interface_health: "Ninety days of IDoc and qRFC/tRFC traffic. It shows interface messages that failed, stalled or are still queued before they become missing transactions.",
  material_master: "Materials across their general, plant and valuation views, with descriptions, material types, groups and units of measure. It drives purchasing, inventory, production and product costing.",
  mm_purchasing: "Purchasing documents at header, item and history level, with their document types. They trace each purchase from order to goods receipt and invoice.",
  payroll_integration: "The data that feeds payroll: basic pay, payroll results and wage-type totals, and payroll run results from SuccessFactors. It confirms that what employees are paid matches their records.",
  plant_maintenance: "Equipment and functional locations: the technical objects that maintenance is planned, executed and costed against.",
  process_discovery: "Sales, delivery, billing, goods movement, invoice receipt and requisition documents, with the flow configuration behind them. Meridian uses them to reconstruct how processes actually run, from level 1 to level 5.",
  production_planning: "Manufacturing master data: routings, bills of material and work centres. Together they determine what is produced, how and where.",
  project_system: "Project definitions, WBS elements, orders and settlement rules, with the controlling and organisational structures they settle to. They govern how project costs are planned, collected and settled.",
  proven_cost: "Schedule lines, info records, unit conversions, invoice items, sales order status and cleared supplier items. Meridian uses them to put a monetary value on the cost of data defects.",
  quality_management: "Inspection setup, task lists and characteristics, inspection lots and quality notifications. They control how materials are inspected and how defects are recorded.",
  s4_load_sim: "Customer-vendor links, credit control, storage locations, pricing conditions and output status. Meridian uses them to rehearse S/4HANA migration loads before cut-over.",
  sd_customer_master: "Customers at general and sales area level. These records determine how orders are priced, shipped and billed.",
  sd_sales_orders: "Sales orders at header and item level: the source of every delivery, invoice and revenue posting.",
  benefits: "Employee benefit enrolments, the basis for benefit deductions and provider files.",
  compensation: "Compensation records with recurring and one-time pay components. They define what each employee is paid and are passed to payroll.",
  learning_management: "Each employee's learning history, the evidence for mandatory training and certification compliance.",
  performance_goals: "Goal plan templates and the individual goals set against them, the basis of performance reviews.",
  recruiting_onboarding: "Job requisitions and the applications received against them, from opening a role to hiring.",
  succession_planning: "Successor nominations for key roles, the basis of talent and continuity planning.",
  time_attendance: "Employee time records, with time type and time account configuration. They drive absence balances and time-based pay.",
  concur_expense: "Expense reports and their entries, with the expense group configuration that governs them. They determine what is reimbursed and how it is posted.",
  concur_travel: "Travel requests raised and approved before a trip.",
  concur_users: "Concur user profiles, which control who can submit and approve expenses and travel.",
  ariba_contracts: "Supplier contracts managed in SAP Ariba, which set the agreed terms for purchasing.",
  ariba_procurement: "Purchase orders and supplier invoices processed in SAP Ariba, from order to payment.",
  ariba_spend: "Spend analysis records that classify what the organisation buys and from whom.",
  ariba_supplier: "Supplier master records managed in SAP Ariba, used for sourcing, ordering and payment.",
  batch_management: "Batch master records for batch-managed materials, the basis of traceability and shelf-life control.",
  ewms_stock: "Warehouse stock by quant, storage bin and handling unit, with warehouse and storage type configuration. It is the physical view of inventory.",
  ewms_transfer_orders: "Open and confirmed warehouse tasks and warehouse orders by storage type: the movements that put away, pick and replenish stock.",
  fleet_management: "Vehicle master records for the fleet, used to plan, maintain and cost vehicles.",
  grc_compliance: "Risk items recorded in SAP GRC, the register behind access control and compliance reporting.",
  mdg_master_data: "Master Data Governance change requests for materials: proposed changes and their approval status.",
  transport_management: "Freight orders planned and executed in transport management.",
  wm_interface: "Transfer requirements raised by inventory management for warehouse management to fulfil.",
};

/** The object's description from `MODULE_DESCRIPTIONS`, or undefined. */
export function moduleDescription(id: string): string | undefined {
  return Object.hasOwn(MODULE_DESCRIPTIONS, id) ? MODULE_DESCRIPTIONS[id] : undefined;
}

/**
 * "fi_gl" -> "FI general ledger": the module's name from `MODULE_LABELS`. An id missing there is sentence-cased
 * ("new_module" -> "New module"), which also names dimensions ("completeness" -> "Completeness").
 */
export function formatModuleName(name: string): string {
  if (Object.hasOwn(MODULE_LABELS, name)) return MODULE_LABELS[name];
  const s = name.replace(/_+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "1 record", "2,310 records": a count with its noun agreed. `pluralForm` defaults to `singular + "s"`. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`;
}

/** "GL024, GL003 and 3 more": the first `max` items, then how many are left. */
export function shortList(items: readonly string[], max = 2): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
}

/** Currency amounts use the code the API sends ("ZAR 5,672,930"), in the viewer's locale; no code, no symbol. */
export function formatMoney(n: number, currency?: string | null): string {
  const base = { maximumFractionDigits: 0 };
  try {
    return currency
      ? new Intl.NumberFormat(formatPrefs.locale, { ...base, style: "currency", currency, currencyDisplay: "code" }).format(n)
      : new Intl.NumberFormat(formatPrefs.locale, base).format(n);
  } catch {
    return `${currency ?? ""} ${new Intl.NumberFormat(undefined, base).format(n)}`.trim();
  }
}

const MONEY_SCALES = [
  { at: 1e12, unit: "tn" },
  { at: 1e9, unit: "bn" },
  { at: 1e6, unit: "m" },
] as const;

/**
 * Headline money (stat tiles, sentences): "ZAR 4.84 bn", "ZAR 12.3 m", three significant figures from a million up;
 * below that the full amount as `formatMoney` gives it. Tables and exports keep `formatMoney`'s exact figure.
 */
export function formatMoneyCompact(n: number | null | undefined, currency?: string | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const scale = MONEY_SCALES.find((s) => Math.abs(n) >= s.at);
  if (!scale) return formatMoney(Math.round(n), currency);
  const value = new Intl.NumberFormat(formatPrefs.locale, { maximumSignificantDigits: 3 }).format(n / scale.at);
  return `${currency ? `${currency} ` : ""}${value} ${scale.unit}`;
}

/** The short name of a time zone ("UTC", "GMT+2"), for a column header that states the zone once instead of every cell. */
export function zoneName(tz: string, at: Date = new Date()): string {
  try {
    return intl({ timeZoneName: "short" }, tz).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

const SYSTEM_TYPE_LABELS: Record<string, string> = {
  ecc: "ECC",
  s4hana_onprem: "S/4HANA on premise",
  s4hana_cloud: "S/4HANA Cloud",
  successfactors: "SuccessFactors",
  concur: "Concur",
  ariba: "Ariba",
  btp: "BTP",
  ewm: "EWM",
};

/** "ecc" -> "ECC", "s4hana_cloud" -> "S/4HANA Cloud"; unknown types are humanized. */
export function systemTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return SYSTEM_TYPE_LABELS[type] ?? labelOf(type);
}

/**
 * Axis labels for a run series keyed by run id: the date, or date and time when two runs share a day, with seconds
 * when two share a minute, and an ordinal ("#2", in run order) when even the second is shared.
 * Run labels are user-supplied upload names, so they never become ticks; this is the one tick formatter.
 */
export function runAxisLabels(runs: readonly { id: string; run_at: string | null | undefined }[]): Map<string, string> {
  const kinds = ["date", "datetime", "seconds"] as const;
  const tally = kinds.map((k) => {
    const m = new Map<string, number>();
    for (const r of runs) {
      const key = formatDate(r.run_at, k);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  });
  const out = new Map<string, string>();
  const ordinal = new Map<string, number>();
  const ordered = [...runs].sort((a, b) => (a.run_at ?? "").localeCompare(b.run_at ?? ""));
  for (const r of ordered) {
    const level = kinds.findIndex((k, i) => (tally[i].get(formatDate(r.run_at, k)) ?? 0) <= 1);
    if (level >= 0) {
      out.set(r.id, formatDate(r.run_at, kinds[level]));
      continue;
    }
    const key = formatDate(r.run_at, "seconds");
    const n = (ordinal.get(key) ?? 0) + 1;
    ordinal.set(key, n);
    out.set(r.id, key === "—" ? key : `${key} #${n}`);
  }
  return out;
}

/**
 * Option labels for a run picker: the run's label, and where two runs share a label, the label with the run's
 * date (disambiguated as on the axis), so 19 runs of "controlling_1k" read as 19 different options.
 */
export function runOptionLabels(runs: readonly { id: string; label?: string | null; run_at: string | null | undefined }[]): Map<string, string> {
  const base = (r: (typeof runs)[number]) => r.label || formatDate(r.run_at, "datetime");
  const groups = new Map<string, (typeof runs)[number][]>();
  for (const r of runs) groups.set(base(r), [...(groups.get(base(r)) ?? []), r]);
  const out = new Map<string, string>();
  for (const [name, group] of groups) {
    if (group.length === 1) { out.set(group[0].id, name); continue; }
    const when = runAxisLabels(group);
    // A label that already is the date is replaced by the finer date, never repeated beside it.
    for (const r of group) out.set(r.id, r.label ? `${name}, ${when.get(r.id)}` : when.get(r.id) ?? name);
  }
  return out;
}

/** Rule ids named in a DQS cap reason ("2 critical failures over tolerance (MM140: 3.2% of MARA rows; ...)"). */
export function capRuleIds(reason: string | null | undefined): string[] {
  if (!reason) return [];
  const inner = /\((.*)\)/.exec(reason)?.[1] ?? reason;
  const ids = inner.split(";").flatMap((part) => {
    const m = /^\s*([A-Za-z][A-Za-z0-9_.-]*):/.exec(part);
    return m ? [m[1]] : [];
  });
  return [...new Set(ids)];
}

/** "6 critical rules over tolerance: CO003, CO020 and 4 more": a cap reason short enough for a hero, two rules named. */
export function shortCapReason(reason: string | null | undefined, named = 2): string {
  if (!reason) return "";
  const ids = capRuleIds(reason);
  if (ids.length <= 1) return reason.replace(/\s*[—-]\s*score capped at \d+$/, "");
  const shown = ids.slice(0, named).join(", ");
  const more = ids.length - Math.min(named, ids.length);
  return `${plural(ids.length, "critical rule")} over tolerance: ${shown}${more > 0 ? ` and ${more} more` : ""}`;
}

/** "Up 2.1 since the last run", "Down 0.8 since the last run", "Unchanged since the last run"; null means no earlier run. */
export function deltaSentence(delta: number | null | undefined, since = "since the last run"): string {
  if (!isNum(delta)) return "First scored run";
  const r = round1(delta);
  if (r === 0) return `Unchanged ${since}`;
  return `${r > 0 ? "Up" : "Down"} ${Math.abs(r)} ${since}`;
}

/** "Composite score rose from 60 to 70 over 3 runs.", or "held at 70 over 2 runs." when first and last are equal. */
export function trendSentence(first: number, last: number, runs: number, subject = "Composite score"): string {
  const a = round1(first);
  const b = round1(last);
  const over = `over ${plural(runs, "run")}`;
  if (a === b) return `${subject} held at ${a} ${over}.`;
  return `${subject} ${b > a ? "rose" : "fell"} from ${a} to ${b} ${over}.`;
}

/** Relative time: "2 hours ago", "3 days ago" */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Plain-English names for the check engine's check_class ids (checks/runner.py REGISTRY). */
const CHECK_CLASS_LABELS: Record<string, string> = {
  null_check: "Required value",
  regex_check: "Pattern match",
  domain_value_check: "Allowed values",
  cross_field_check: "Field-to-field consistency",
  referential_check: "Exists in check table",
  freshness_check: "Date not too old",
  format_check: "Check digit or format",
  field_status_check: "Field status (required or hidden)",
  uniqueness_check: "No duplicates",
  value_placement_check: "Value in the right field",
  balance_check: "Debits equal credits",
  country_format_check: "Country-specific format",
  aggregate_check: "Group totals agree",
  interval_check: "Validity periods",
  exists_check: "Linked record exists",
  similarity_check: "Near-duplicates",
  group_sum_check: "Group total vs. limit",
  hierarchy_check: "Hierarchy loop",
};

/** "domain_value_check" -> "Allowed values"; unknown ids are humanized ("older_than_days" -> "Older than days"). */
export function checkClassLabel(id: string): string {
  if (Object.hasOwn(CHECK_CLASS_LABELS, id)) return CHECK_CLASS_LABELS[id];
  const s = id.replace(/_/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Locale and time zone from the user's preferences (lib/preferences.ts pushes them here). Unset means the
 * shared defaults: en-GB, UTC. This module imports nothing so `node lib/format.test.mjs` can load it directly. */
let formatPrefs: { locale?: string; timezone?: string } = {};

export function setFormatPrefs(prefs: { locale?: string; timezone?: string }): void {
  formatPrefs = { locale: prefs.locale || undefined, timezone: prefs.timezone || undefined };
}

/** An Intl formatter that tolerates a bad locale or zone by falling back to the shared defaults. */
function intl(options: Intl.DateTimeFormatOptions, zone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(formatPrefs.locale ?? "en-GB", { ...options, timeZone: zone });
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  }
}

/** Number formatting in the user's locale (the browser's when none is set). */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  try {
    return n.toLocaleString(formatPrefs.locale, options);
  } catch {
    return n.toLocaleString(undefined, options);
  }
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const DATETIME_OPTS: Intl.DateTimeFormatOptions = { ...DATE_OPTS, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const SECONDS_OPTS: Intl.DateTimeFormatOptions = { ...DATETIME_OPTS, second: "2-digit" };

/** The tenant's time zone (IANA), set by whoever loads it (GET /api/v1/triage/settings): the default when the user
 * chose no zone of their own. Unset means UTC. */
let tenantZone: string | undefined;

export function setTenantTimezone(zone: string | null | undefined): void {
  tenantZone = zone || undefined;
}

/** True when `zone` is a time zone this runtime knows (an IANA name such as "Europe/Berlin", or "UTC"). */
export function isValidTimeZone(zone: string | null | undefined): boolean {
  if (!zone || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's IANA zone, for when no tenant zone is known yet. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The one date style: "2 Oct 2026" or "2 Oct 2026, 05:09", in the user's chosen zone, else the tenant's, else
 * UTC. With an explicit IANA `tz` (schedule and sign-off times, read in the tenant's zone) the time is shown in
 * that zone and labelled with it: "2 Oct 2026, 07:09 GMT+2", unless `zoneLabel` is false (a table that names the zone
 * in its header, `zoneName`). An unparseable value is an em dash. */
export function formatDate(iso: string | number | Date | null | undefined, kind: "date" | "datetime" | "seconds" = "date", tz?: string, zoneLabel = true): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const d = iso instanceof Date ? iso : new Date(typeof iso === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(iso) ? `${iso}Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts = kind === "date" ? DATE_OPTS : kind === "seconds" ? SECONDS_OPTS : DATETIME_OPTS;
  if (!tz) return intl(opts, formatPrefs.timezone ?? tenantZone ?? "UTC").format(d);
  const text = intl(opts, tz).format(d);
  if (kind === "date" || !zoneLabel) return text;
  const zone = intl({ timeZoneName: "short" }, tz).formatToParts(d).find((p) => p.type === "timeZoneName")?.value;
  return zone ? `${text} ${zone}` : text;
}

const LABEL_OVERRIDES: Record<string, string> = {
  not_yet_checked: "Not yet checked",
  pending_approval: "Pending approval",
  auth_failed: "Sign-in refused",
};

/** "pending_approval" -> "Pending approval": a status or other machine value as a sentence-case label. */
export function labelOf(value: string | null | undefined): string {
  if (!value) return "—";
  if (Object.hasOwn(LABEL_OVERRIDES, value)) return LABEL_OVERRIDES[value];
  const s = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A config impact feature's display name: a machine id reads as words; a transaction code (MIGO) keeps its case. */
export function featureLabel(feature: string): string {
  return feature.includes("_") || feature === feature.toLowerCase() ? labelOf(feature) : feature;
}

const ERROR_LABELS: Record<string, string> = {
  pyrfc_not_installed: "SAP RFC library is not installed on the worker. Install pyrfc or use file import.",
};

/** A job error such as "pyrfc_not_installed: build the wheel" as a sentence; unknown codes are humanized. */
export function errorLabel(error: string | null | undefined): string {
  if (!error) return "—";
  const code = error.split(":")[0].trim();
  if (Object.hasOwn(ERROR_LABELS, code)) return ERROR_LABELS[code];
  return humanizeIds(error);
}

/** Server copy with machine ids ("accounts_payable") rewritten as names ("Accounts payable"). */
export function humanizeIds(text: string): string {
  return text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, formatModuleName);
}

/** The eight DAMA-style dimensions the rule library is organised by, in matrix order. */
export const DIMENSIONS = [
  { id: "completeness", label: "Completeness" },
  { id: "consistency", label: "Consistency" },
  { id: "validity", label: "Validity" },
  { id: "accuracy", label: "Accuracy" },
  { id: "uniqueness", label: "Uniqueness" },
  { id: "timeliness", label: "Timeliness" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "freshness", label: "Freshness" },
] as const;

/** Where a rule's authority comes from, as a sentence. */
export const AUTHORITY_SENTENCE: Record<string, string> = {
  sap_hard_constraint: "SAP hard constraint: SAP itself rejects or breaks on this.",
  sap_standard: "SAP standard: SAP itself requires or enforces this.",
  sap_documented: "SAP documented: SAP documentation recommends this.",
  best_practice: "Best practice: not enforced by SAP, but widely expected.",
  industry_best_practice: "Industry best practice: not enforced by SAP, but widely expected.",
  regulatory: "Regulatory: a legal or tax rule requires this.",
  iso_standard: "ISO standard: an international standard requires this.",
  s4hana_migration: "S/4HANA migration: this must be clean before the move to S/4HANA.",
  customer_configured: "Customer configured: your own organisation defined this rule.",
};

/** A check-engine expression with its backticks and operators put into words. */
const plainExpr = (s: string) => s.replace(/`/g, "").replace(/\s*&\s*/g, " and ").replace(/\s*\|\s*/g, " or ")
  .replace(/\.isna\(\)/g, " is blank").replace(/\.notna\(\)/g, " is filled").replace(/==/g, "equals");

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
const some = (xs: string[], n = 6) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", "));

/** The condition under which a rule fails a record, in a sentence. Falls back to the rule's own message. */
export function failsWhen(rule: {
  check_class?: string | null; field?: string | null; fail_when?: unknown; allowed_values?: unknown; pattern?: string | null;
  reference_table?: string | null; reference_field?: string | null; max_age_hours?: number | null; target_table?: string | null;
  target_fields?: unknown; group_by?: unknown; message?: string | null; extra?: Record<string, unknown>;
}): string {
  const f = rule.field ?? "the field";
  const e = rule.extra ?? {};
  if (typeof rule.fail_when === "string" && rule.fail_when.trim()) return `Fails when ${plainExpr(rule.fail_when)}.`;
  switch (rule.check_class) {
    case "null_check": return `Fails when ${f} is blank.`;
    case "regex_check": return rule.pattern ? `Fails when ${f} does not match the pattern ${rule.pattern}.` : `Fails when ${f} has the wrong format.`;
    case "domain_value_check": {
      const v = list(rule.allowed_values);
      return v.length ? `Fails when ${f} is not one of ${some(v)}.` : `Fails when ${f} holds a value outside the allowed list.`;
    }
    case "referential_check":
      return rule.reference_table ? `Fails when ${f} has no entry in ${rule.reference_table}${rule.reference_field ? `.${rule.reference_field}` : ""}.`
        : `Fails when ${f} is not in the reference list.`;
    case "freshness_check": return rule.max_age_hours != null ? `Fails when ${f} is older than ${rule.max_age_hours.toLocaleString()} hours.` : `Fails when ${f} is too old.`;
    case "uniqueness_check": {
      const g = list(e.fields ?? rule.group_by);
      return g.length ? `Fails when more than one record has the same ${some(g)}.` : `Fails when more than one record has the same ${f}.`;
    }
    case "exists_check": {
      const t = list(rule.target_fields);
      return rule.target_table ? `Fails when no ${rule.target_table} record${t.length ? ` matches on ${some(t)}` : " exists"}.` : "Fails when the linked record is missing.";
    }
    default: break;
  }
  return rule.message ? `Fails when the record breaks this rule: ${rule.message}` : "The rule has no stated condition.";
}

/** "MATNR=100|WERKS=1000" -> [{ key: "MATNR", value: "100" }, ...] */
export function recordKeyParts(key: string): { key: string; value: string }[] {
  return key.split("|").map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? { key: "", value: p } : { key: p.slice(0, i), value: p.slice(i + 1) };
  }).filter((p) => p.value !== "" || p.key !== "");
}

const OBJECT_NOUN: Record<string, string> = {
  material_master: "Material", business_partner: "Business partner", customer_master: "Customer", vendor_master: "Vendor",
  gl_account: "G/L account", cost_center: "Cost centre", profit_center: "Profit centre", equipment: "Equipment",
};
/** Singular noun for one record of a module: "material_master" -> "Material". */
export function objectNoun(module: string): string {
  return OBJECT_NOUN[module] ?? formatModuleName(module).replace(/ (master|data)$/i, "");
}

const KEY_LABEL: Record<string, string> = { LIFNR: "vendor", KUNNR: "customer", MATNR: "material", BUKRS: "company code", WERKS: "plant", EKORG: "purchasing org", VKORG: "sales org", VTWEG: "distribution channel", SPART: "division", LGORT: "storage location", KOKRS: "controlling area", KOSTL: "cost centre", SAKNR: "account", EBELN: "purchase order", VBELN: "document" };

/** "BUKRS" -> "company code": a record key field as a noun; unknown fields are lower-cased. */
export function keyFieldLabel(field: string): string {
  return KEY_LABEL[field.toUpperCase()] ?? field.toLowerCase();
}

/** "LIFNR=V3|BUKRS=1000" becomes "Vendor V3, company code 1000". A key that is not field=value pairs is returned as is. */
export function recordKeyLabel(key: string): string {
  const parts = key.split("|").map((p) => p.split("="));
  if (!parts.every((p) => p.length === 2 && p[0] && p[1])) return key;
  const text = parts.map(([k, v]) => `${keyFieldLabel(k)} ${v}`).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NULL_DASH = "—";
const isNum = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const INT_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "12,480". Null or non-finite is an em dash, never 0. */
export function formatInt(n: number | null | undefined): string {
  return isNum(n) ? INT_FMT.format(n) : NULL_DASH;
}

/** "1.2M", "123.5K" from 100,000 up (Stat tiles and chart axes only); below that the full grouped integer. */
export function formatCompact(n: number | null | undefined): string {
  if (!isNum(n)) return NULL_DASH;
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${round1(n / 1_000_000)}M`;
  if (a >= 100_000) return `${round1(n / 1_000)}K`;
  return formatInt(n);
}

/** Scores keep one decimal, including a trailing zero: "87.0". */
export function formatScore(n: number | null | undefined): string {
  return isNum(n) ? round1(n).toFixed(1) : NULL_DASH;
}

/** Percent from a 0..100 number: "96%" at 10 and above, "3.4%" below, "<0.1%" floor, "0%" for exactly 0. */
export function formatPct(p: number | null | undefined): string {
  if (!isNum(p)) return NULL_DASH;
  if (p === 0) return "0%";
  if (p > 0 && p < 0.1) return "<0.1%";
  return p >= 10 ? `${Math.round(p)}%` : `${round1(p)}%`;
}

/**
 * A finding's pass rate on the 0..100 scale. `findings.pass_rate` is written 0..100 by the check engine
 * (checks/base.py) but older rows hold a 0..1 share; a value at or below 1 is read as the share, as FindingDrawer does.
 */
export function passRatePct(p: number | null | undefined): number | null {
  if (!isNum(p)) return null;
  return p <= 1 ? p * 100 : p;
}

/** "+2.1" or "−0.8" (U+2212), one decimal; zero is "0.0". */
export function formatDelta(n: number | null | undefined): string {
  if (!isNum(n)) return NULL_DASH;
  const r = round1(n);
  if (r === 0) return "0.0";
  return r > 0 ? `+${r.toFixed(1)}` : `−${Math.abs(r).toFixed(1)}`;
}

/** "42s", "4m 12s", "1h 03m". Under a second is "<1s". */
export function formatDuration(ms: number | null | undefined): string {
  if (!isNum(ms)) return NULL_DASH;
  const s = Math.round(ms / 1000);
  if (ms < 1000) return "<1s";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
