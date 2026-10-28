# Reading the insights

Insights answer what a fix list cannot: which problems matter most, whether the clean-up is working, and what a number refuses to tell you. Every view reads the run in the scope bar, so check which run you are on before you repeat a figure.

## Failing rules: what breaks most

The rules view ranks rules by impact: failing records multiplied by a severity weight, critical counting highest. It is a ranking of where to put people, not money.

Read three things before you act. The pass rate says how much of what the rule checked failed, and is honest only with its basis: a rule that checked nine records tells you less than one that checked nine hundred. The change since the last run of the same system says whether it is growing or shrinking; only rules that ran in both runs are compared, so a rule you switched off cannot read as a fix. The object and field say who has to be involved to change it.

Open a rule and you get the finding: what failed, how many records, why it matters, samples, and the fix. That is the normal route into clean-up work. A few rules account for most of the impact, so work that handful first.

## Progress and trends: did the fix stick

A trend answers a narrower question than a score does. It re-scores a system's finished runs under today's weights, so the comparison is like for like, and never crosses lineages.

Did a fix stick is a different test from did a fix happen. A value you approved is not a fix. A record a later run found passing is. Check three things in order: the open count falling, the fixed count rising in a later run, and the recurrence figure, which counts issues that failed again after being fixed.

A high recurrence rate on one rule is the most useful signal in the view. It says the cause is upstream: an interface, a default or a setting keeps writing the bad value, and cleaning those records again moves the numbers and changes nothing on the ground. Where the pace is flat there is no projected finish, and the page says so rather than inventing one.

## Forecast, and its limits

The forecast projects each object's score 7, 30 and 90 days ahead, and needs finished runs on three different days before it will draw a line. The shaded band is the range the score is likely to fall in: read the band, not the tip of the line.

The assumption in the name is the method. It continues the recent trend, which means the same objects are worked, at the same pace, under the same rules, and nothing new breaks. That makes it useful as a warning and poor as a plan: it cannot know about a mass change you are about to load, or a rule you are about to publish.

Say its limits wherever the figure appears. It is per object, so there is no single forecast for the landscape, and a thin history gives a smooth line rather than a reliable one. An object held down by a cap can jump the moment one rule clears, which a line drawn from small changes will not predict.

## Root causes and duplicates

The root causes view groups failures by origin rather than by record. It separates a data problem, a value that is simply wrong or missing, from a configuration problem, where the field or setting means the rule cannot be satisfied as things stand. The distinction decides who does the work: data goes to stewards, configuration to whoever owns customising. Cleaning records against a configuration problem wastes the week, because the next record is wrong the same way.

Duplicates come from match rules, which compare one field at a time and score each pair a confidence. The [duplicates](/insights/duplicates) view shows a cluster of records that appear to describe the same thing. Pick the record that should survive and create a merge proposal, which is a request, not an action: a second person compares the pair, gives a reason, and merges or rejects it. Do not merge in bulk. A wrong merge is worse than a duplicate, because it ends one record's history quietly.

## Coverage honesty

A high score says the rules that ran, on the records they checked, mostly passed. It does not say the data is good.

Before you quote a score, check the basis. How many rules apply to that object, and how many have ever run? If no configuration was loaded, rules apply by default and measure the wrong thing. If an imported file had no column for a required field, every check that needed it was skipped. If a rule is suppressed until a date, its failures are out of the score for now. Where a rule could not be evaluated, a coverage badge says so, and that is not a pass.

Ask three questions of any score you report: how many rules, over how many records, how many skipped. A 100 built on four rules over a narrow scope is not a clean object. It is an unmeasured one.

## Next steps

- Rank the work at [Failing rules](/insights/rules).
- Check whether the backlog is falling at [Progress](/insights/progress).
- Read the projection, and its limits, at [Forecast](/insights/forecast).
