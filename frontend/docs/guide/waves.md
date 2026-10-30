# Waves and gates

A migration wave is a set of objects moved together in one cutover, with a target date, a stage and a gate: the conditions every object must meet before the wave may go. The landscape's **Waves** view shows each wave with its verdict counts and gate state; the **Migration waves** panel is where the programme lead plans waves and sets gates. Open the view with **Waves** on the landscape (`/v2?view=waves`) and the panel with **Edit** on a wave (`?open=waves`).

## The Waves view

Each wave heading reads, for example, "Wave 1: finance foundations, due 16 Nov 2026, 1 go, 0 at risk, 3 no-go, Gate not passed, 2 of 3 not met", with **Edit**. Under it, the wave's objects with their ruler, score, verdict, records and rules. The programme lead's next-step button follows the nearest wave: "Clear the 3 no-go objects in Wave 1: finance foundations" with "Wave 1: finance foundations: due 16 Nov 2026, in 17 days. 1 go, 0 at risk, 3 no-go."

An object's own **Readiness** tab lists its waves with the verdict, blocking gaps, score, readiness and records blocked, and the wave threshold.

## The Migration waves panel

For each wave: **Name**, **Target date**, **Stage** (Plan, Mock load 1, Mock load 2, Dress rehearsal, Cutover) and its sign-off state ("Not signed off.").

**Gate**: up to three conditions, each with what fails it now:

- **Min score**: "Every object at 85.0 or more", with the objects below it.
- **Zero criticals**: "No critical rule over tolerance", with the objects capped by a critical rule.
- **Contracts met**: "Data contracts met", or "No active contract names these objects."

**Save the gate** stores it. "No gate yet: a wave without one moves on its verdict alone."

**Readiness certificate**: "not yet (the signed certificate arrives in step 9)". The link shows the certificate's current checks; a signed PDF is not produced in this version.

**Add a wave** creates one; **Objects** assigns each object to a wave or to none; **Save changes** or **Discard**. **Delete** removes a wave.

## The numbers and where they come from

- **Go, at risk, no-go** counts are the verdicts of the wave's objects in the run in the top bar, from the score bands.
- **Gate state** checks each condition against the same run: the shown scores, the critical rules over tolerance, and the active contracts that name the objects.
- **Due in N days** counts from today to the target date.

## What you can do, by role

- **Programme lead** (analyse): plan waves, set gates, assign objects.
- **Data owner**: read the gate state of their objects' waves.
- **Everyone**: read the Waves view.
- Signing a wave off is done in the cockpit of the current interface for now; the panel shows the state.

## Keyboard

- `g` then `l`, then the **Waves** view switch.
- `Esc` closes the panel.

## When something is wrong

- **A wave shows every object no-go but scores look close to target**: the cap holds them. The gate's **Zero criticals** line names the objects; clear their critical rules first.
- **Contracts met says no contract names the objects**: create one in People, Data contracts, or remove the condition.
- **The certificate says "not yet"**: expected in this version.
