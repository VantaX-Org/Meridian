# Meridian 2 Accessibility Conformance Report

**WCAG Edition (Based on VPAT® Version 2.5)**

## Name of Product/Version

Meridian 2, the v2 interface of the Meridian SAP data quality and master data management platform (frontend routes
`/v2/*`, `/v2/status` and `/status`), build of October 2026 (Meridian 2, step 8).

## Report Date

29 October 2026

## Product Description

Meridian is deployed in the customer's own environment. The v2 interface is a web application with a top bar, a map
of the SAP landscape (systems and objects), a canvas, an inspector panel and a status strip; an administration area;
and a status page readable without signing in. It is available in English, German and Japanese.

## Contact Information

The Meridian product team, through the support channel named in the customer's contract. Use Help, Contact support in
the product to attach the diagnostics block to a request.

## Notes

- Scope: every screen under `design/v2` and `app/(v2)`, the status page and the sign-in page's tenant branding. The
  current interface (`/home` and the other pages outside `/v2`) is not covered by this report.
- Screens owned by a parallel work stream at the time of testing (system configuration, the rules library and the
  object tabs under `design/v2/screens/object/`) were included in the automated axe runs (the Object page and its Rules
  tab) but their wording is not yet localised; German and Japanese users see English text in those panes.
- Content supplied by the server or the customer (help chapters, training recordings, server error messages, object
  and field names the API sends) is shown as delivered.
- The method and every finding are in [audit-2026-10.md](./audit-2026-10.md).

## Evaluation Methods Used

1. Automated testing with axe-core 4.11 (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) through
   `@axe-core/playwright` on 30 v2 page states in English, German and Japanese, light and dark theme, at 1440 x 900
   (`frontend/e2e/v2-a11y.spec.ts`, `frontend/e2e/v2-status.spec.ts`, and the step 0 to 6 specs `e2e/v2-*.spec.ts`).
2. Scripted keyboard-only walkthroughs of the five main flows in Chromium (Playwright), checking focus order, the
   focus ring, skip links and landmarks.
3. Layout checks: 200 % zoom at 1440 (a 720 CSS px viewport at device scale 2), reflow at 320 CSS px, and the
   three languages at 1440 and 390, with screenshots.
4. `prefers-reduced-motion` emulation.
5. Contrast arithmetic for the design tokens and for tenant accents (WCAG relative luminance, unit-tested in
   `frontend/design/v2/__tests__/Enterprise.test.tsx`).
6. Component tests (Vitest, Testing Library) for roles, names and states.

No screen reader (NVDA, JAWS, VoiceOver) session and no test with users with disabilities was run for this report.
Criteria that depend on them are marked accordingly.

## Applicable Standards/Guidelines

| Standard/Guideline | Included In Report |
|---|---|
| [Web Content Accessibility Guidelines 2.0](https://www.w3.org/TR/2008/REC-WCAG20-20081211) | Level A (Yes), Level AA (Yes), Level AAA (No) |
| [Web Content Accessibility Guidelines 2.1](https://www.w3.org/TR/WCAG21) | Level A (Yes), Level AA (Yes), Level AAA (No) |
| [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22) | Level A (No), Level AA (No), Level AAA (No) |

## Terms

- **Supports**: The functionality of the product has at least one method that meets the criterion without known
  defects or meets with equivalent facilitation.
- **Partially Supports**: Some functionality of the product does not meet the criterion.
- **Does Not Support**: The majority of product functionality does not meet the criterion.
- **Not Applicable**: The criterion is not relevant to the product.
- **Not Evaluated**: The product has not been evaluated against the criterion. This can only be used in WCAG Level
  AAA criteria; this report also uses it, openly, for A and AA criteria whose test was not run (see the remarks).

## WCAG 2.x Report

### Table 1: Success Criteria, Level A

| Criteria | Conformance Level | Remarks and Explanations |
|---|---|---|
| 1.1.1 Non-text Content (Level A) | Supports | axe `image-alt`, `svg-img-alt`, `role-img-alt` pass on all pages. Marks (verdict, severity) are `aria-hidden` and always sit beside a word; rulers and the 30-day uptime bar are `role="img"` with a sentence that states the values. A tenant logo is decorative (`alt=""`) beside the product name; the logo preview is named "Logo preview". |
| 1.2.1 Audio-only and Video-only (Prerecorded) (Level A) | Not Evaluated | The help panel links training recordings supplied separately; their content was not reviewed. |
| 1.2.2 Captions (Prerecorded) (Level A) | Not Evaluated | The recordings are played without a caption track; whether they carry speech was not reviewed. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) (Level A) | Not Evaluated | As 1.2.1. The written help chapter beside each recording covers the same task. |
| 1.3.1 Info and Relationships (Level A) | Supports | One `h1` per page; banner, main, two complementary landmarks (map, inspector) and contentinfo (status strip); tables use `th` with `scope`; data grids use `role="grid"` with row and column headers; every field has a label. axe structure rules pass in all languages and themes. |
| 1.3.2 Meaningful Sequence (Level A) | Supports | DOM order matches reading order: top bar, map, canvas, inspector, status strip. |
| 1.3.3 Sensory Characteristics (Level A) | Supports | Instructions refer to names ("Open the rule", "Save the mapping"), never to shape, colour or position alone. |
| 1.4.1 Use of Color (Level A) | Supports | Status is a shape and a word (verdict and severity marks); the uptime bar has a word beside it and a sentence; links inside sentences are underlined. |
| 1.4.2 Audio Control (Level A) | Not Applicable | Nothing plays sound on its own. |
| 2.1.1 Keyboard (Level A) | Supports | Keyboard-only walkthroughs pass for: landscape to object to the rule inspector; a ledger decision and Undo (Ctrl+Z); approving a batch and Undo; starting an extraction as Basis; inviting a user. The fix-sheet drop zone has a file input. |
| 2.1.2 No Keyboard Trap (Level A) | Supports | Dialogs and the inspector keep Tab inside while open and Esc closes them, returning focus to what opened them. |
| 2.1.4 Character Key Shortcuts (Level A) | Partially Supports | Grid and ledger keys (j, k, x, a, n, r) act only while the grid has focus. The go-to sequences (g then l, w, r, p) and `?` are page-wide and cannot be switched off or remapped; they are ignored while typing in a field. |
| 2.2.1 Timing Adjustable (Level A) | Partially Supports | A change notice's Undo button shows for 6 seconds; the same Undo stays available through Ctrl+Z for the server's 10 minutes. No other time limit is set by the interface. |
| 2.2.2 Pause, Stop, Hide (Level A) | Partially Supports | Nothing moves or blinks. The status page reads the status every minute and the job line follows running jobs; neither can be paused. |
| 2.3.1 Three Flashes or Below Threshold (Level A) | Supports | No flashing content. |
| 2.4.1 Bypass Blocks (Level A) | Supports | Skip links to the content, the map and the open inspector (tested), plus landmarks. The status page has its own skip link. |
| 2.4.2 Page Titled (Level A) | Supports | The window title names the page from its `h1`, in the interface's language ("Users – Meridian", "Status – Meridian"). |
| 2.4.3 Focus Order (Level A) | Supports | Opening the inspector moves focus to its Close button; closing returns focus to the element that opened it (tested). |
| 2.4.4 Link Purpose (In Context) (Level A) | Supports | Link text names its destination ("Open the rule", "Back to Meridian"); repeated "Open" buttons in grids carry the row in their name. |
| 2.5.1 Pointer Gestures (Level A) | Supports | No path-based or multipoint gestures. |
| 2.5.2 Pointer Cancellation (Level A) | Supports | Native buttons and links activate on release. |
| 2.5.3 Label in Name (Level A) | Supports | Accessible names that differ from visible text contain it ("Inbox 7, unread" for the button reading "Inbox 7"; "Platform Degraded, open the status page"). Fixed during this audit. |
| 2.5.4 Motion Actuation (Level A) | Not Applicable | No device-motion input. |
| 3.1.1 Language of Page (Level A) | Supports | `<html lang>` follows the interface language (`en`, `de-DE`, `ja-JP`, or the chosen regional tag). |
| 3.2.1 On Focus (Level A) | Supports | Focus never submits, navigates or opens anything. |
| 3.2.2 On Input (Level A) | Supports | Choosing a language or format in Preferences changes the interface in place and says so; no input navigates without a button. |
| 3.3.1 Error Identification (Level A) | Supports | Field errors are text in `role="alert"` next to the field; failed reads and writes say what failed in place. |
| 3.3.2 Labels or Instructions (Level A) | Supports | Every field has a visible label and, where a format is required, a hint (cron line, ISO 4217 code, `#rrggbb`). |
| 4.1.1 Parsing (Level A) | Supports | React output; axe `duplicate-id-aria` passes. (Obsolete in WCAG 2.2.) |
| 4.1.2 Name, Role, Value (Level A) | Supports | Menus, dialogs, grids, switches and segmented buttons expose role, name and state (`aria-expanded`, `aria-pressed`, `aria-checked`, `aria-current`); axe ARIA rules pass. |

### Table 2: Success Criteria, Level AA

| Criteria | Conformance Level | Remarks and Explanations |
|---|---|---|
| 1.2.4 Captions (Live) (Level AA) | Not Applicable | No live media. |
| 1.2.5 Audio Description (Prerecorded) (Level AA) | Not Evaluated | See 1.2.1. |
| 1.3.4 Orientation (Level AA) | Supports | Works at 390 x 844 (portrait) and 1440 x 900 (landscape). |
| 1.3.5 Identify Input Purpose (Level AA) | Partially Supports | The sign-in form uses `autocomplete` tokens; the invite form's email field sets `autocomplete="off"` and the profile fields carry no tokens. |
| 1.4.3 Contrast (Minimum) (Level AA) | Supports | axe `color-contrast` passes on every page in both themes and all three languages. A tenant accent is refused below 4.5:1 on the light ground and replaced by a tint that reaches 4.5:1 on the dark ground. |
| 1.4.4 Resize text (Level AA) | Supports | At 200 % zoom (1440 window) no page scrolls sideways and no control is cut off (tested on landscape, object, work, settings, users, status, preferences, in all three languages). |
| 1.4.5 Images of Text (Level AA) | Supports | No images of text; a tenant logo is the tenant's own mark. |
| 1.4.10 Reflow (Level AA) | Supports | At 320 CSS px the page never scrolls sideways (tested on five pages in German). Data grids and the coverage matrix scroll inside their own frame, which the criterion allows for two-dimensional data. |
| 1.4.11 Non-text Contrast (Level AA) | Partially Supports | The focus ring (data hue) reaches at least 3:1 on both grounds, and status marks reach 3:1. The 1px borders of text fields and secondary buttons (`--m2-line-2`) are about 1.6:1 against the sheet; those controls are identified by their visible label and position. |
| 1.4.12 Text Spacing (Level AA) | Not Evaluated | No text-spacing override test was run. |
| 1.4.13 Content on Hover or Focus (Level AA) | Supports | The explanation popovers open on activation, not hover, and close with Esc; other hover text is the browser's own `title` tooltip. |
| 2.4.5 Multiple Ways (Level AA) | Supports | The map, the command line (search, `/` or Ctrl+K), and links from every summary. |
| 2.4.6 Headings and Labels (Level AA) | Supports | Headings name their section; labels name their field. |
| 2.4.7 Focus Visible (Level AA) | Supports | One focus ring from the tokens (`--m2-focus`, 2px, offset 2px) on every focusable element; menu items show an inset ring. Checked in the keyboard walkthroughs. |
| 3.1.2 Language of Parts (Level AA) | Partially Supports | The language picker marks each language name with its own `lang`. English text sent by the server (help chapters, error sentences, object names the catalogue does not know) appears inside German and Japanese pages without `lang="en"`. |
| 3.2.3 Consistent Navigation (Level AA) | Supports | The top bar, map and status strip are the same on every v2 page. |
| 3.2.4 Consistent Identification (Level AA) | Supports | The same function has the same name everywhere (Close, Open the rule, Undo). |
| 3.3.3 Error Suggestion (Level AA) | Supports | Errors say how to fix them ("Each kind of data is kept from 1 to 3650 days", "Choose a darker accent"). |
| 3.3.4 Error Prevention (Legal, Financial, Data) (Level AA) | Supports | Destructive actions ask first; purging all data needs a typed phrase and a 24-hour token; ledger decisions and approvals can be undone. |
| 4.1.3 Status Messages (Level AA) | Supports | Action results are `role="status"`; change notices are a polite live region (errors assertive). |

### Table 3: Success Criteria, Level AAA

Not Evaluated.

## Summary

| | Supports | Partially Supports | Does Not Support | Not Applicable | Not Evaluated |
|---|---|---|---|---|---|
| Level A (30) | 22 | 3 | 0 | 2 | 3 |
| Level AA (20) | 14 | 3 | 0 | 1 | 2 |
| Total (50) | 36 | 6 | 0 | 3 | 5 |

## Legal Disclaimer

This report describes the accessibility of the product as tested on the date above with the methods listed. It is not
a warranty. "VPAT" is a registered service mark of the Information Technology Industry Council (ITI).
