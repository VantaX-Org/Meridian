import { test } from "./fixtures";
import type { Page } from "@playwright/test";
import { personaPermissionsPayload, type PersonaRole } from "./fixtures/persona-permissions";

/**
 * Guided tours for the help centre's training recordings. Each test walks one journey at a
 * human pace over the recorded HAR fixtures — deterministic screens, pinned clock, demo data.
 * Run only by the `recording` project (RECORD_HELP=1); the default project ignores this file.
 * Test title == the journey's `video` key in docs/help-centre/index.json; the workflow renames
 * the captured webm to that title and converts it to mp4 (docs/help-videos.md).
 *
 * Keep steps to routes in e2e/routes.json: those are the screens the fixtures answer without a
 * live backend, so no step can land on an error panel in a training video.
 */

const DWELL_MS = 1_600; // how long each screen stays up: long enough to read, short enough to watch

async function signInAs(page: Page, role: PersonaRole) {
  const payload = personaPermissionsPayload(role);
  await page.route(/\/api\/v1\/me\/permissions/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.route(/\/api\/v1\/auth\/me(\?|$)/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: `e2e-${role}`, email: `${role}@example.test`, name: role, role, permissions: payload.actions, home: payload.home },
        must_change_password: false,
      }),
    }));
}

const JOURNEYS = [
  { video: "help-first-login", role: "programme_lead" as PersonaRole, steps: ["/home", "/search", "/help", "/me/preferences"] },
  { video: "help-first-fix", role: "data_steward" as PersonaRole, steps: ["/home/steward", "/fix", "/inbox"] },
  { video: "help-steward-work", role: "data_steward" as PersonaRole, steps: ["/fix", "/inbox", "/mdm", "/insights/owners"] },
  { video: "help-approver-work", role: "data_owner" as PersonaRole, steps: ["/inbox?kind=approvals", "/fix", "/inbox"] },
  { video: "help-basis-operations", role: "sap_basis" as PersonaRole, steps: ["/home/basis", "/systems", "/runs", "/process"] },
  { video: "help-first-analysis", role: "sap_basis" as PersonaRole, steps: ["/systems", "/objects", "/runs"] },
  { video: "help-analyst-insights", role: "sap_basis" as PersonaRole, steps: ["/objects", "/insights/rules", "/insights/forecast", "/insights/duplicates"] },
  { video: "help-lead-reporting", role: "programme_lead" as PersonaRole, steps: ["/home/lead", "/insights/exec", "/insights/owners", "/insights/reports"] },
  { video: "help-connect-a-system", role: "sap_basis" as PersonaRole, steps: ["/systems"] },
  { video: "help-authoring-rules", role: "sap_basis" as PersonaRole, steps: ["/rules", "/rules/drafts", "/rules/learned"] },
  { video: "help-golden-records", role: "data_steward" as PersonaRole, steps: ["/mdm", "/mdm/golden", "/mdm/match-rules", "/mdm/glossary"] },
  { video: "help-ask-meridian", role: "programme_lead" as PersonaRole, steps: ["/search", "/help", "/docs"] },
  { video: "help-admin-users", role: "platform_admin" as PersonaRole, steps: ["/admin/users", "/admin/roles", "/me/preferences"] },
  { video: "help-admin-rules", role: "platform_admin" as PersonaRole, steps: ["/rules", "/rules/scoring", "/rules/learned", "/rules/dictionary"] },
  { video: "help-admin-runs", role: "platform_admin" as PersonaRole, steps: ["/systems", "/runs", "/admin/jobs", "/process"] },
  { video: "help-admin-assigning-work", role: "platform_admin" as PersonaRole, steps: ["/admin/triage", "/admin/notifications", "/insights/owners", "/insights/reports"] },
  { video: "help-admin-best-practices", role: "platform_admin" as PersonaRole, steps: ["/admin/licence", "/admin/audit", "/admin/settings", "/admin/ai"] },
] as const;

for (const journey of JOURNEYS) {
  test(journey.video, async ({ app }) => {
    test.setTimeout(180_000);
    await signInAs(app, journey.role);
    for (const step of journey.steps) {
      await app.goto(step, { waitUntil: "networkidle" });
      await app.waitForLoadState("domcontentloaded");
      await app.waitForTimeout(DWELL_MS);
    }
  });
}
