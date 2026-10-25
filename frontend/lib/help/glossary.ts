/**
 * The product glossary: one entry per term the UI uses with a specific
 * meaning. `HelpHint` and `Stat help="..."` read it, so a definition is
 * written once. Limits (checked by lib/help/glossary.test.ts): `short` is at
 * most 120 characters, `long` at most 400.
 */
export interface GlossaryEntry {
  term: string;
  short: string;
  long: string;
  /** In-app page that explains the term further; relative, never external. */
  href?: string;
}

export const GLOSSARY = {
  dqs: {
    term: "Data quality score",
    short: "A 0 to 100 score for how fit a run's SAP data is, from six weighted dimensions",
    long: "The data quality score (DQS) averages record-level pass rates across six dimensions: completeness and accuracy 25% each, consistency 20%, timeliness, uniqueness and validity 10% each. Critical failures cap the result, so one blocking rule cannot hide behind many passing ones.",
    href: "/docs?page=objects",
  },
  cap: {
    term: "Cap",
    short: "A ceiling on the score: one critical failure caps it at 85, two or more at 70",
    long: "The cap stops a high average from hiding a blocking defect. One critical failing rule limits the score to 85; two or more limit it to 70. The score always shows the measured value, the cap and the rules that caused it, so you can see what to fix to lift it.",
    href: "/docs?page=concepts",
  },
  dimension: {
    term: "Dimension",
    short: "One of six ways data quality is measured: completeness, accuracy, consistency, timeliness, uniqueness, validity",
    long: "Every rule belongs to one of six DAMA dimensions. Completeness asks whether values are present, accuracy whether they are right, consistency whether systems agree, timeliness whether they are current, uniqueness whether records repeat and validity whether they follow the format.",
    href: "/docs?page=objects",
  },
  basis: {
    term: "Basis",
    short: "What a figure is measured against: the rules that apply and the records they cover",
    long: "A percentage is only meaningful with its denominator. The basis names it: which rules were counted, which records they ran over and which run produced them. Rules that do not apply to your configuration are left out of the basis rather than counted as passes.",
    href: "/docs?page=rules",
  },
  scope: {
    term: "Scope",
    short: "The systems, objects and records a figure or a role covers",
    long: "Scope limits a view to part of the landscape: one system, a set of objects or a record filter. A role can be scoped too, so a person only sees and changes what they are responsible for. A figure shown for a scope is not a total for the whole tenant.",
    href: "/docs?page=admin",
  },
  applicability: {
    term: "Applicability",
    short: "Whether a rule applies to a system: applies, does not apply, applies by default or not available",
    long: "Once configuration is loaded, each rule is checked against it. Applies means the configuration uses the field. Does not apply means it does not, so the rule is skipped. Applies by default means no configuration is loaded yet. Not available means the system cannot supply what the rule needs.",
    href: "/docs?page=rules",
  },
  grain: {
    term: "Grain",
    short: "The level a rule is evaluated at, such as one record, one line item or one document",
    long: "A rule runs at a grain: a header row, a line item, a document or a whole object. Counting a failure at the right grain keeps the pass rate honest, for example one purchase order with five bad lines is one failing document and five failing lines.",
    href: "/docs?page=rules",
  },
  populationExclusion: {
    term: "Population exclusion",
    short: "Records a rule deliberately skips, such as blocked or archived entries",
    long: "Some records should not be judged by a rule, for example a vendor already flagged for deletion. A population exclusion removes them from the rule's denominator. Excluded records are neither passes nor failures, and the exclusion is listed with the rule so it can be reviewed.",
    href: "/docs?page=rules",
  },
  fieldStatus: {
    term: "Field status",
    short: "Whether a field is required, optional or hidden in your SAP configuration",
    long: "SAP screens mark each field as required, optional, display only or suppressed. Meridian reads that status from configuration and uses it to decide whether an empty value is a defect. A required field that is empty fails; a suppressed one is not expected to hold data.",
    href: "/docs?page=data-in",
  },
  unmaintainedField: {
    term: "Unmaintained field",
    short: "A field that exists in SAP but is almost never filled in",
    long: "An unmaintained field is present on the screen and in the table, yet nearly every record leaves it empty. It usually means the field is not part of the business process any more. Meridian lists these so you can retire the field or the rule that checks it.",
    href: "/docs?page=data-in",
  },
  rootCause: {
    term: "Root cause",
    short: "Whether a failure comes from bad data, bad configuration, or both",
    long: "A failing rule can be a data problem, such as a mistyped value, or a configuration problem, such as a field that is mandatory in the rule but not in SAP. Root cause tells them apart from change history and configuration, so the fix goes to the right team.",
    href: "/docs?page=objects",
  },
  provenCost: {
    term: "Proven cost",
    short: "Money measured on posted documents that broke a rule, not an estimate",
    long: "Proven cost is calculated from real documents in SAP that were posted with a defective value, such as a payment sent twice or a price off by a tolerance. It is shown per top-level process in the tenant currency and is never summed across processes.",
    href: "/docs?page=analysis",
  },
  variant: {
    term: "Variant",
    short: "A distinct path that cases take through a process, listed by how many cases follow it",
    long: "In process discovery every case is a sequence of steps. Cases with the same sequence form one variant. The most common variant is usually the happy path. Many rare variants point to rework, workarounds or steps done out of order.",
    href: "/docs?page=analysis",
  },
  happyPath: {
    term: "Happy path",
    short: "The most common route through a process, ideally the one the design intended",
    long: "The happy path is the single most frequent variant. Its share of all cases shows how standard the process really is. A low share means cases take many different routes, which usually costs time and makes the process harder to automate.",
    href: "/docs?page=analysis",
  },
  conformance: {
    term: "Conformance",
    short: "How closely discovered cases follow the intended process model",
    long: "Conformance replays each discovered case against the reference model and reports where it deviates: skipped steps, extra steps and wrong order. It is summarised as fitness and listed per step so a deviation can be traced to the cases that caused it.",
    href: "/docs?page=analysis",
  },
  fitness: {
    term: "Fitness",
    short: "A 0 to 1 measure of how many cases can be replayed on the model without deviation",
    long: "Fitness is 1 when every discovered case fits the reference model exactly and falls as cases skip, repeat or reorder steps. The home page shows the median across processes. Open conformance to see which steps pull it down.",
    href: "/docs?page=analysis",
  },
  goldenRecord: {
    term: "Golden record",
    short: "The single best version of an entity, assembled from matching records across systems",
    long: "When several records describe the same business partner or material, Meridian merges them into one golden record. Survivorship rules choose each field's value from the best source. The golden record links back to every source record, so a change can be traced and reversed.",
    href: "/docs?page=mdm",
  },
  survivorship: {
    term: "Survivorship",
    short: "The rules that pick which source value wins for each field of a golden record",
    long: "Survivorship decides, field by field, which value a golden record keeps when sources disagree: the most recent, the most complete, the trusted system or the most frequent. Rules can be inferred by AI for review but only take effect once a person activates them.",
    href: "/docs?page=mdm",
  },
  matchRule: {
    term: "Match rule",
    short: "A rule that scores how likely two records describe the same real-world entity",
    long: "A match rule compares chosen fields, exactly or fuzzily, and gives each candidate pair a confidence between 0 and 1. Pairs above the auto-merge threshold are merged, pairs in the review band go to a steward and pairs below it are left alone.",
    href: "/docs?page=mdm",
  },
  contract: {
    term: "Contract",
    short: "An agreed quality level for an object that is checked on every run",
    long: "A data contract states the thresholds a data set must meet, such as a minimum score or a maximum number of failing records. After each run the contract is evaluated and marked met or breached. Breaches notify the owner and show on the contracts page.",
    href: "/docs?page=rules",
  },
  wave: {
    term: "Wave",
    short: "A batch of objects and systems migrated together, with one go or no-go verdict",
    long: "A migration wave groups the objects planned to move to S/4HANA in one cutover. Each wave has a minimum readiness. The verdict is go when the wave meets it, at risk when close and no go when blocking records remain, with the blockers listed.",
    href: "/docs?page=data-in",
  },
  dryRun: {
    term: "Dry run",
    short: "A trial load that shows what the target system would reject, without changing anything",
    long: "A dry run applies the target system's own checks to the source records and reports which would be blocked and why. Nothing is written to SAP. Use it before each wave to turn surprises at load time into a fix list days earlier.",
    href: "/docs?page=data-in",
  },
  zObject: {
    term: "Z-object",
    short: "A customer-defined table, field or program in SAP, named with a Z or Y prefix",
    long: "Z-objects are custom extensions that standard checks do not know about. Meridian detects them, lists who owns them and whether they are documented, and flags unusual values in them so custom data is held to the same standard as the standard fields.",
    href: "/docs?page=data-in",
  },
  ghostConfig: {
    term: "Ghost configuration",
    short: "Configuration that exists in SAP but is never used in a transaction",
    long: "Ghost configuration is set up in customising, such as a payment term or a plant, but no document ever references it. It adds noise to checks and choices to users. The list helps you decide what to retire before a migration.",
    href: "/docs?page=data-in",
  },
  drift: {
    term: "Drift",
    short: "A change in configuration or data behaviour since the last time it was read",
    long: "Drift is recorded when a later configuration read differs from the earlier one, such as a field turned from optional to required. Each drift entry names what changed and when, so a score change can be linked to a change in SAP rather than to the data.",
    href: "/docs?page=data-in",
  },
  run: {
    term: "Run",
    short: "One analysis of one system or file: its scores, findings and records at that moment",
    long: "A run is one pass of every applicable rule over the data read from one system (or one uploaded file). It carries its scores, findings and the records behind them, and it never changes afterwards. Runs of the same system line up in time, which is what progress, trends and the forecast read.",
    href: "/runs",
  },
  previous_run: {
    term: "Previous run",
    short: "The finished run of the same system that came just before this one",
    long: "Change on a run page, the Runs ledger and Trends is measured against the previous run: the newest finished run of the same system (or of the same uploaded objects) that started earlier. Runs of other systems are never compared with each other.",
    href: "/runs",
  },
  baseline: {
    term: "Baseline",
    short: "The run you pinned to measure progress against; without one, the previous run is used",
    long: "Pin any finished run as the baseline of its system and every later run reports its change since that run, on the Since baseline page and in the progress report. Without a pinned baseline the comparison falls back to the previous run. One baseline per system; pinning another replaces it.",
    href: "/insights/progress",
  },
  current_state: {
    term: "Current state",
    short: "Every object at its latest finished run, combined: the whole landscape as it stands today",
    long: "Home and the Insights summary read the current state: each object as measured by the newest finished run of its system, so a system analysed yesterday and a file uploaded today both count. Choose a run under Showing to read that one run alone instead.",
    href: "/home",
  },
  pinned_run: {
    term: "Pinned run",
    short: "An older run opened by its link; the page reads that run, not the latest",
    long: "A page normally shows the latest finished run. Opening a run from the ledger, a trend point or a shared link pins that run: every number on the page comes from it and the header names it. Back to latest returns to the newest run.",
    href: "/runs",
  },
  window: {
    term: "Window",
    short: "How many of the latest runs a trend draws",
    long: "Trends draw the last 6, 12 or 24 finished runs of one system, newest on the right. A wider window shows the long arc; a narrower one makes the last few changes readable. The window never mixes runs of different systems.",
    href: "/insights/trends",
  },
  verdict: {
    term: "Verdict",
    short: "Go, At risk or No-go: whether the score clears the target, is near it, or is below the warning line",
    long: "The verdict turns a score into a decision using the tenant's bands: Go at or above the target, At risk between the warning line and the target, No-go below it. Objects, waves and processes carry the same three words, so a reader never needs a second scale.",
    href: "/rules/scoring",
  },
  blocking_finding: {
    term: "Blocking finding",
    short: "A failing rule that is critical, or that the S/4HANA readiness pack counts as blocking",
    long: "A blocking finding stops a migration wave: the rule is critical (it caps the score), or the S/4HANA readiness pack marks it as blocking the load. Pages that count every critical and high finding say \"Critical and high findings\" instead. Counts of blocking findings open the readiness view behind them.",
    href: "/insights/readiness",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function isGlossaryKey(key: string): key is GlossaryKey {
  return Object.prototype.hasOwnProperty.call(GLOSSARY, key);
}

export function glossaryEntry(key: GlossaryKey): GlossaryEntry {
  return GLOSSARY[key];
}
