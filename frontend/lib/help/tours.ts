/**
 * Guided tours. A step names its target by `data-tour` attribute value (the
 * attribute sits on an existing element), so a tour never depends on markup
 * shape or class names. `design/shell/Tour.tsx` renders them.
 *
 * `href` moves the tour to the page that holds the target before the step
 * shows. It may carry tokens that `lib/help/tour-links.ts` resolves from live
 * data: `{run}` the selected run, `{system}` the first system, `{object}` the
 * object with the most failing checks, `{l1}` / `{l1run}` the first process
 * with a completed discovery run. A step whose href cannot be resolved (for
 * example no system yet) is skipped.
 */
export type TourPlacement = "top" | "bottom" | "left" | "right";

export interface TourStep {
  /** The `data-tour` attribute value of the element to spotlight. */
  target: string;
  title: string;
  body: string;
  placement?: TourPlacement;
  /** Page to open first, when the target lives somewhere other than the tour's start page. */
  href?: string;
  /** Skip the step when the target is absent (a control the viewer's role never renders). */
  optional?: boolean;
}

export interface TourDef {
  id: string;
  title: string;
  /** Route that offers this tour from the help menu. */
  route?: string;
  /** A dismissed offer counts as done, so it is not shown again. */
  oneShot?: boolean;
  steps: TourStep[];
}

export const TOURS: readonly TourDef[] = [
  {
    id: "steward",
    title: "Steward tour",
    route: "/home/steward",
    steps: [
      {
        target: "inbox-queue", href: "/inbox", placement: "top",
        title: "Your queue",
        body: "Every open task for you and your team, most urgent first. Select a row to open the record behind it.",
      },
      {
        target: "finding-rows", href: "/runs/{run}?tab=findings", placement: "top",
        title: "Findings and the finding drawer",
        body: "Each row is a failing rule. Select one to open its drawer: what failed, how many records, why it matters, samples and the suggested fix.",
      },
      {
        target: "object-rules", href: "/objects/{object}?run={run}&tab=rules", placement: "top",
        title: "Sample records",
        body: "Open a rule on an object to see the failing records with their values, then open the fix sheet to correct one.",
      },
      {
        target: "fix-batches", href: "/fix?tab=batches", placement: "bottom",
        title: "Fix batches",
        body: "Accepted proposals are grouped into batches. Approve a batch, export it for loading into SAP, and the next run checks that the records now pass.",
      },
      {
        target: "help-menu", placement: "bottom",
        title: "Keyboard keys",
        body: "Press ? on any page to see every shortcut. In the inbox, j and k move between tasks, a assigns, r resolves and x rejects.",
      },
    ],
  },
  {
    id: "lead",
    title: "Lead tour",
    route: "/home/lead",
    steps: [
      {
        target: "home-verdict", href: "/home/lead", placement: "bottom",
        title: "The verdict",
        body: "One sentence says whether your data is ready, with the number that caused it and the next action to take.",
      },
      {
        target: "home-score", href: "/home/lead", placement: "left",
        title: "Score and cap",
        body: "The score is the measured value. When a critical rule fails it is capped at 85, or 70 for two or more, and the rules that caused the cap are named beside the verdict.",
      },
      {
        target: "home-trend", href: "/home/lead", placement: "right",
        title: "Trend",
        body: "The score over runs. Select a point to open that run and see what changed.",
      },
      {
        target: "home-export", href: "/home/lead", placement: "bottom", optional: true,
        title: "Executive report",
        body: "Export the executive report as a PDF to share the verdict, the trend and the blocking rules.",
      },
      {
        target: "insight-views", href: "/insights/exec", placement: "bottom",
        title: "Five views",
        body: "Summary, Progress, Explore, Readiness and Operate. Each view's detail screens sit in this strip, and every page offers Run analysis, Auto clean, Present and Export.",
      },
      {
        target: "owners", href: "/insights/owners", placement: "top",
        title: "Owners",
        body: "Who owns the open items, their score and whether it is improving. Start with the lowest score.",
      },
    ],
  },
  {
    id: "basis",
    title: "Basis tour",
    route: "/home/basis",
    steps: [
      {
        target: "systems-list", href: "/systems", placement: "top",
        title: "Systems",
        body: "Every connected system with its health, configuration state and last extraction. Select one to open it.",
      },
      {
        target: "system-connection", href: "/systems/{system}?tab=health", placement: "bottom",
        title: "Connection",
        body: "Test the connection to a system here. A healthy connection is the first step before anything can be extracted.",
      },
      {
        target: "system-extract", href: "/systems/{system}", placement: "bottom",
        title: "Extraction run",
        body: "Extract chooses which objects to read into a new run. Extract and analyse also scores them when the read finishes.",
      },
      {
        target: "config-load", href: "/systems/{system}?tab=health", placement: "top",
        title: "Configuration load",
        body: "Reading the system's configuration tells Meridian which rules apply, so unused fields are not counted as defects.",
      },
      {
        target: "schedules", href: "/systems/{system}?tab=health", placement: "top",
        title: "Schedules",
        body: "Re-evaluate an object on a schedule, in full or as a delta, so the score stays current without a manual run.",
      },
    ],
  },
  {
    id: "process",
    title: "Process tour",
    route: "/home/process",
    steps: [
      {
        target: "process-catalogue", href: "/process", placement: "top",
        title: "Process list",
        body: "One row per level 1 process for the chosen system, with coverage, fitness, variants and cases. Select a process to drill down.",
      },
      {
        target: "process-tabs", href: "/process/{l1}?system={system}&run={l1run}&tab=variants", placement: "top",
        title: "Variants",
        body: "Each variant is a distinct path that cases take. The most common is the happy path; many rare variants point to rework.",
      },
      {
        target: "process-tabs", href: "/process/{l1}?system={system}&run={l1run}&tab=conformance", placement: "top",
        title: "Conformance",
        body: "How closely the cases follow the reference model, summarised as fitness and listed by step.",
      },
      {
        target: "designer-canvas", href: "/insights/process/designer", placement: "top",
        title: "Designer",
        body: "Edit the process model and overlay the latest data quality analysis to see which steps are blocked.",
      },
      {
        target: "process-export", href: "/process/{l1}?system={system}&run={l1run}&tab=flow", placement: "bottom", optional: true,
        title: "Signavio export",
        body: "Export the discovered model as a package for Signavio, or a single step as BPMN.",
      },
    ],
  },
  {
    id: "first-run",
    title: "A quick look around",
    oneShot: true,
    steps: [
      {
        target: "rail", placement: "bottom",
        title: "Navigation",
        body: "The places you go most are the pills; everything else is under More.",
      },
      {
        target: "command-palette", placement: "bottom",
        title: "Search and jump",
        body: "Press the command key and K to jump to any page, object or rule without using the menu.",
      },
    ],
  },
];

export function tourById(id: string, tours: readonly TourDef[] = TOURS): TourDef | undefined {
  return tours.find((t) => t.id === id);
}

/** The tour a route offers from the help menu, matched on the path without its query string. */
export function tourForPath(pathname: string, tours: readonly TourDef[] = TOURS): TourDef | undefined {
  return tours.find((t) => t.route !== undefined && t.route === pathname);
}

/** Home routes that offer the first-run tour. */
export const FIRST_RUN_TOUR_ID = "first-run";
export const HOME_ROUTES: readonly string[] = ["/home/lead", "/home/steward", "/home/basis", "/home/process"];
