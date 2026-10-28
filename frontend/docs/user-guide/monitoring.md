# Monitoring

Meridian keeps watching your data between the times someone opens it. Each object has a cadence, a freshness, a baseline it is compared with and a record of what changed since. This chapter explains what those words mean, where to read them and how to change them.

## What is monitored

Monitoring is per object. An object is one kind of SAP data, such as Business partner or Material master, read from one system. Every object that has been checked at least once has a monitor, and an object with two checks is already compared with something: you do not have to set anything up first.

You can read the monitor in three places:

- On the object page, a row of tiles sits under the page header.
- On the [Objects](/objects?view=monitoring) list, the **Monitoring** view swaps the work columns for **Checked**, **Cadence**, **Freshness** and **Change** beside the score and verdict. The default view keeps its usual columns and adds **Freshness**.
- On the [To do](/attention) list, an object that has gone stale, a schedule that failed or a rule that started failing becomes an item with its own action.

## The tiles on an object page

- **Checked**: how long ago the object was last checked, and what started it: the schedule, an upload, a person's re-check or a person starting it by hand. Select it to open that run. An object that has never run reads **Not checked yet**.
- **Cadence**: how often the object is checked, such as **Daily at 02:00**, **Weekly, Monday 02:00**, **Hourly**, **Manual only** or **Paused**. Times are shown in your organisation's time zone, which an administrator sets under Triage.
- **Next check**: when the schedule will start the next check, or a dash when there is no schedule or it is paused.
- **Freshness**: one pill that says whether the data is as recent as its cadence promises. The next section explains the six states.
- **Baseline**: the run the latest check is compared with. It reads **Pinned run of** a date when someone pinned one, or **Previous run** when Meridian picked the run before it.
- **Newly failing rules** and **Recovered rules**: how many rules fail now that did not fail in the baseline, and how many failed in the baseline and no longer do. The hint under each counts records: select the new failing records to open them in Fix work, or the recovered records to open the comparison of the two runs. Up to two of the newly failing rule IDs are named.

Until an object has a second run, the last tile reads **First run** and says changes show from the second run.

## Freshness states

Freshness is judged against the object's own cadence, never against a fixed number of days.

- **Fresh**: green. The last check is on schedule.
- **Due**: neutral. The next check is due now and has not started yet.
- **Stale**: amber. The last check is older than one and a half times the cadence, and never less than two hours, so an hourly schedule that misses one slot is not yet stale.
- **Failed**: red. The last extraction from the system failed. This wins over stale, because the failure is the reason.
- **Paused**: neutral. Someone paused the schedule. A pause is a decision, so it is never stale and raises no to do item.
- **Manual**: neutral. The object has no schedule, for example because you upload files. It shows only how long ago it was checked and is never called stale.

## Baseline and drift

The baseline is the reference for "what changed". Two kinds exist:

- A **pinned** baseline is one a person chose, usually the run that shows the data after a clean-up. Select **Pin this run as baseline** on the object page, or **Pin as baseline** on a run. Pinning needs the analyse permission.
- An **automatic** baseline is the previous finished run of the same object. It is used only when nothing is pinned.

Drift is the difference between the latest run and the baseline. **Newly failing rules** is the number to watch. When a rule that matters, one of critical or high severity, starts failing again, Meridian sends a **Regression** notification and puts an item on the To do list. A pinned baseline also lets Meridian draft a fix batch for the records that came back; an automatic baseline never drafts one, because nobody said the data had been cleaned.

## Re-check now

**Re-check now** on the object page starts a fresh extraction and analysis of that object from its system. It needs permission to trigger syncs on that system; without it the button is visible but asks you to request access. If the object came from an uploaded file there is no system to read, so the button becomes **Upload a new file**. If the object is already being checked, Meridian says so and starts nothing.

## Schedules

A schedule tells Meridian to check an object by itself.

- **Set schedule** (when there is none) and **Change schedule** open the system's schedules. Choose a preset or write your own timetable in the standard five-field form. People with permission to manage systems can pause, resume or delete a schedule.
- Open a system, then **Schedules**, to see every object it checks: its cadence, mode (**Full extraction** or **Changes only**), last run, next run and freshness.
- Under the same tab, **Process discovery** lists the business processes that are mined again on a timetable. Select **Add schedule**, choose the process and a cadence. The process page then shows its own **Checked**, **Cadence**, **Freshness** and **Fitness change** tiles. Fitness change is how many points the share of cases that follow the expected flow moved since the run before; a drop of five points or more becomes a to do item.

A run records who started it. On [Runs](/runs), the **Started by** column reads **Schedule**, a person's name, **Upload** or **Re-check**.

## When a check fails or is late

If a scheduled check fails, the object turns **Failed** and the To do list offers **Retry**. If a schedule misses its slot by more than fifteen minutes, it appears as a missed schedule with **Open schedules**. If an object goes stale, the action is **Re-check now**. Each of these needs the permission to trigger syncs, so only people who can act on them see them. See [To do](/docs?page=todo) for how the list is ranked.

## Related

- [Objects](/docs?page=objects)
- [To do](/docs?page=todo)
- [Progress](/docs?page=progress)
- [Data in](/docs?page=data-in)
