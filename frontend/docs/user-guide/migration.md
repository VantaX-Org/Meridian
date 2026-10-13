# Migration

Migration tells you whether your data is ready to move to S/4HANA, wave by wave, and what is stopping it.

## Waves

A wave is a batch of objects and systems planned to move in one cutover. Each wave has a minimum readiness. The waves list counts waves by verdict:

- **Go** means the wave meets its minimum.
- **At risk** means it is close.
- **No go** means blocking records remain.

Select a count to filter the list.

## One wave

Open a wave to see its verdict, its readiness against the minimum, the number of records blocked and the trend across runs. Its tabs are:

1. **Overview** shows readiness per object.
2. **Blockers** lists the records that would be rejected, with the rule and the reason.
3. **S/4 readiness** shows what the target system's own checks would object to.

## Dry run

A dry run applies the target system's checks to your source records and reports which would be blocked and why. Nothing is written to SAP. Run one before each wave to turn surprises at load time into a fix list days earlier.

## Fixing blockers

Create a fix batch from the blockers of a wave. The records are corrected in your source, then the next run confirms they now pass and the verdict updates.

## Planning

Use the trend to decide whether a wave is moving the right way. A wave that is At risk and improving is a different decision from one that is At risk and flat.
