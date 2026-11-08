import { t } from "@/lib/v2/i18n";

export interface MenuLink {
  href: string;
  label: string;
  /** Permission without which the screen is only a locked form; the link is left out of the menu, the route still opens. */
  need?: string;
}

export interface Destination {
  id: "home" | "objects" | "runs" | "fix" | "rules" | "master" | "migration";
  href: string;
  label: string;
  /** One line, shown in the flyout before the click. */
  about: string;
  /** The key after `g`. */
  key: string;
  /** Child routes; Objects has none, its flyout is the system and object tree. */
  kids: MenuLink[];
  /** Routes that belong here without being listed: object pages, run detail, rule detail. */
  also: string[];
}

/** The seven destinations of the rail, built at call time so labels follow the language. Every route has one home here. */
export function destinations(): Destination[] {
  return [
    { id: "home", href: "/", label: t("Home"), about: t("What needs attention today, across every system."), key: "h", kids: [], also: [] },
    { id: "objects", href: "/objects", label: t("Objects"), about: t("Every object, scored at its latest run. Open any object at any run."), key: "o", kids: [], also: ["/o", "/s"] },
    { id: "runs", href: "/runs", label: t("Runs"), about: t("Every scoring run, by system. Compare any two."), key: "r", kids: [], also: ["/run"] },
    {
      id: "fix",
      href: "/attention",
      label: t("Fix"),
      about: t("Findings to act on, fixes to approve, people to chase."),
      key: "f",
      kids: [
        { href: "/attention", label: t("Action centre") },
        { href: "/work", label: t("Work") },
        { href: "/fix-drafts", label: t("Aletheia verified fixes") },
        { href: "/cleansing", label: t("Cleansing") },
        { href: "/requests", label: t("Requests") },
        { href: "/people", label: t("People") },
      ],
      also: [],
    },
    {
      id: "rules",
      href: "/rules",
      label: t("Rules"),
      about: t("What is checked, how rules are promoted, and what Aletheia learned."),
      key: "u",
      kids: [
        { href: "/rules", label: t("Rules") },
        { href: "/rule-promotion", label: t("Aletheia rule promotion"), need: "manage_rules" },
        { href: "/rule-dry-run", label: t("Rule dry run"), need: "manage_rules" },
        { href: "/anomaly-rules", label: t("Anomaly rules") },
        { href: "/monitors", label: t("Learned monitors") },
        { href: "/aletheia-survivorship", label: t("Aletheia verified survivorship") },
        { href: "/aletheia/evidence", label: t("Evidence ledger") },
      ],
      also: ["/r", "/aletheia"],
    },
    {
      id: "master",
      href: "/mdm",
      label: t("Master data"),
      about: t("Entry gate, reference data, links and the health of what is already clean."),
      key: "m",
      kids: [
        { href: "/mdm", label: t("MDM health") },
        { href: "/entry-gate", label: t("Entry gate") },
        { href: "/reference-data", label: t("Reference data") },
        { href: "/links", label: t("Record links") },
        { href: "/materials", label: t("Material 360") },
        { href: "/issues", label: t("Issues") },
        { href: "/mining", label: t("Data mining") },
        { href: "/processes", label: t("Process discovery") },
      ],
      also: [],
    },
    {
      id: "migration",
      href: "/migration",
      label: t("Migration"),
      about: t("Readiness for S/4, value, forecast and go-live."),
      key: "i",
      kids: [
        { href: "/migration", label: t("Migration") },
        { href: "/s4", label: t("S/4HANA readiness") },
        { href: "/go-live", label: t("Go-live") },
        { href: "/forecast", label: t("Forecast and plan") },
        { href: "/value", label: t("Value delivered") },
        { href: "/score", label: t("Score lens") },
        { href: "/insights", label: t("Cost and causes") },
        { href: "/config", label: t("Configuration") },
      ],
      also: [],
    },
  ];
}

const within = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** The destination that owns a path: its landing route, a listed child or one of its unlisted routes. */
export function destinationAt(path: string, all: Destination[]): Destination | undefined {
  if (path === "/") return all[0];
  return all.slice(1).find((d) => [d.href, ...d.kids.map((k) => k.href), ...d.also].some((b) => within(path, b)));
}

/** The links this person can use: each role sees only the tools it can act with. */
export const kidsFor = (dest: Destination, can: (p: string) => boolean): MenuLink[] => dest.kids.filter((k) => !k.need || can(k.need));
