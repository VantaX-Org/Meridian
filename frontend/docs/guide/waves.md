# Waves and gates

A migration wave is a set of objects moved together in one cutover, with a target date, a stage and a gate: the conditions every object must meet before the wave may go. The landscape's **Waves** view shows each wave with its verdict counts and gate state; the **Migration waves** panel is where the programme lead plans waves and sets gates. Open the view with **Waves** on the landscape (`/?view=waves`) and the panel with **Edit** on a wave (`?open=waves:{id}`), which opens that wave first with its gate on top and the other waves collapsed.

## The Waves view

Each wave heading reads, for example, "Wave 1: finance foundations, due 16 Nov 2026, 1 go, 0 at risk, 3 no-go, Gate not passed, 2 of 3 not met", with **Edit** and **Certificate**. At phone width the heading stays above each wave's objects, with the same gate state and both links. Under it, the wave's objects with their ruler, score, verdict, records and rules. The programme lead's next-step button follows the nearest wave: "Clear the 3 no-go objects in Wave 1: finance foundations" with "Wave 1: finance foundations: due 16 Nov 2026, in 17 days. 1 go, 0 at risk, 3 no-go."

An object's own **Readiness** tab lists its waves with the verdict, blocking gaps, score, readiness and records blocked, and the gate's threshold in the same words as the gate ("Gate: min score 85.0"). An object no run has scored yet for its wave shows no readiness or records blocked; the tab says so instead of showing zeros.

## The Migration waves panel

For each wave: **Name**, **Target date**, **Stage** (Plan, Mock load 1, Mock load 2, Dress rehearsal, Cutover) and its sign-off state ("Not signed off.").

**Gate**: up to three conditions, each with what fails it now:

- **Min score**: "Gate: min score 85.0", with the objects below it. The same words appear on the Readiness tab and the Waves view.
- **Zero criticals**: "No critical rule over tolerance", with the objects capped by a critical rule.
- **Contracts met**: "Data contracts met", or "No active contract names these objects."

**Save the gate** stores it. "No gate yet: a wave without one moves on its verdict alone."

**Readiness certificate**: the latest issued version and its state, for example "Version 2, waiting for signatures" or "Version 2, signed", or "Not issued". **Open the certificate** opens it: issue a new version, sign it, or download the PDF. When the gate refuses an issue, the certificate lists each object in the way, linked to its page, with the rules that stop it.

**Add a wave** creates one; **Objects** assigns each object to a wave or to none; **Save changes** or **Discard**. **Delete** removes a wave.

## The numbers and where they come from

- **Go, at risk, no-go** counts are the verdicts of the wave's objects in the run in the top bar, from the score bands.
- **Gate state** checks each condition against the same run: the shown scores, the critical rules over tolerance, and the active contracts that name the objects.
- **Due in N days** counts from today to the target date.

## What you can do, by role

- **Programme lead** (analyse): plan waves, set gates, assign objects.
- **Data owner**: read the gate state of their objects' waves.
- **Everyone**: read the Waves view.
- **Sign off** (approve): on each wave in the Migration waves panel, once its verdict is go. The panel shows who signed it off and when; any later change to the wave clears the sign-off.

## Keyboard

- `g` then `l`, then the **Waves** view switch.
- `Esc` closes the panel.

## When something is wrong

- **A wave shows every object no-go but scores look close to target**: the cap holds them. The gate's **Zero criticals** line names the objects; clear their critical rules first.
- **Contracts met says no contract names the objects**: create one in People, Data contracts, or remove the condition.
- **The certificate says "Not issued"**: no version is issued yet. Open the certificate and issue one once the gate passes; if it refuses, the list under the button names the objects and rules to clear.
