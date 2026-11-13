# The cleaning cycle

An object page walks one cleaning cycle in five steps. Pick the object, the version and the run in the bar at the top, then open **Cycle**. Each step shows a short list of checks; the one button at the bottom stays off until the checks for that step pass.

## The five steps

1. **Pull**: read the object from the connected system. The step is blocked until the object has a run.
2. **Clean**: download the cleaning workbook. It holds the template, the instructions and the failing records. Edit it in Excel. If you already hold the workbook, tick **I already have the workbook** to go on.
3. **Upload**: add the cleaned workbook. Meridian checks each file before it scores anything: the fingerprint, the run, the template, the columns, the rows, the keys, the values and the formulas. A failed check blocks the button. A warning lets you go on once you tick **Add it with these warnings**.
4. **Score**: Meridian scores the copy as a new run. The step waits while scoring runs and stops if it fails.
5. **Compare**: see the new score next to the previous one. **Start the next cycle** returns to the clean step.

Use **Back** to return to an earlier step. Every other tab of the object stays reachable at any time.

## Downloads

Press `d` or open **Downloads** in the bar. Each item says what it is for: the **cleaning workbook** for the cycle, the **fix workbook** for approved fixes, and **Export in load order** for the target load.

## Shortcuts

- `[` and `]` move to the previous or the next run.
- `u` opens the upload step.
- `d` opens the downloads menu.
