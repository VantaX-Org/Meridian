# Walkthrough: process analyst

You read the data through the business process: which steps of Procure to Pay, Plan to Produce or Order to Cash the data blocks, what fixing a rule would release, and whom to hand a blocking rule to. Your start screen is the **Landscape** with "Open PTP step 3" as your next step.

## Your first five steps

1. **Landscape**: press **Open PTP step 3**.
2. **Processes tab**: read "2 of 4 process steps are blocked by Material master: PTP step 3, PP step 1." and the fields behind each blocked step.
3. **What if**: tick the rules to fix under **What if these rules were fixed** and see which steps would be ready.
4. **Step inspector**: **Hand off** the blocking rule to a steward with a note.
5. **Process designer**: map the fields each activity reads, then publish the model.

## Your jobs and where they are done

- **Process readiness by step**: Object, **Processes** tab.
- **What if these rules were fixed (simulation)**: Processes tab; computed in the browser, nothing changes and no data is read.
- **Hand a blocking rule to a steward**: Step inspector, **Hand off** (needs handoff rule).
- **Export the as-is process**: Processes and the designer (needs export process).
- **Comment on a rule or a step's rule**: Rule inspector, **Comments**.
- **Related objects and fix order**: Object header, related objects; the fix-order hint in Work.

## The numbers you read

- "A step is blocked when a field it writes fails a critical or high rule, or passes under 70%."
- Failing counts are records, and a record can fail several rules.

## When something is wrong

- **A step you expect blocked is Ready**: its fields are not mapped to the activity. Map them in the designer; it shows on the next run.
- **Hand off is missing**: your role lacks handoff rule.
- **Contact**: the object's owner for priorities, the steward the rule was handed to for progress.
