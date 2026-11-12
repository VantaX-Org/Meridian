/**
 * Click budgets of the journeys in docs/journeys/steps.json. A journey with `target_clicks` carries the target of its
 * row in docs/journeys/README.md; every step whose `control` is clicked counts one click, and the walk may use at most
 * the target plus 20 percent, rounded up. Used by lib/v2/journey-budget.test.ts and e2e/journeys/budgets.spec.ts.
 */

export type JourneyStep = { route: string; control: string | null; expect: string | null; needs?: string };
export type Journey = { id: string; role: string; object: string | null; target_clicks?: number; steps: JourneyStep[] };

/** Clicks a journey takes: one per step with a control. */
export const clicksOf = (j: Journey): number => j.steps.filter((s) => s.control !== null).length;

/** The most clicks a journey with this target may take. */
export const budgetOf = (target: number): number => Math.ceil(target * 1.2);

export const budgetMessage = (id: string, clicks: number, target: number): string =>
  `journey ${id} takes ${clicks} clicks, over its budget of ${budgetOf(target)} (target ${target} plus 20 percent)`;
