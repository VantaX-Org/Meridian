# Your first analysis run

An analysis run is one measurement of your data at one moment. Meridian reads the records, runs every applicable rule over them, and writes down what failed. Every score, failing record and suggested value you see afterwards belongs to that run. Make one now, while the steps are fresh, so the clean-up has something to compare with.

## What a run does

A run has three parts, in this order.

1. Extraction reads the chosen objects from a system and stores the records, so the measurement can be repeated later without going back to SAP.
2. Checks apply each rule that applies to that system and configuration. A rule is one fixed test, so the same records give the same result every time.
3. Scoring turns pass rates into a data-quality score from 0 to 100: rules are grouped into six dimensions, the dimensions are weighted, and a critical failure can cap the total.

A run finishes when the analysis completes. Screens show finished runs only, so a run that is still going cannot mislead you with half numbers.

## Choosing systems, objects and scope

Start from the system you connected. Choose the objects to read: material master, business partner, accounts payable, the warehouse objects. Pick one or two for a first run, so it finishes quickly and the result is easy to read.

Then set the scope. You can limit an extraction to company codes, plants, sales or purchasing organisations, and for transactional objects to a document date window. Leave a field empty to read everything it covers.

Scope matters more than people expect. A narrow scope gives an honest picture of the part of the landscape you chose and nothing else: the score is a figure for that scope, not a total for the installation. A wide first run may take hours and fill the fix list before anyone is ready to work it. One or two objects, a limited scope and a short period is the right first measurement.

## Watching the job, then reading the overview

Open the jobs tray in the top bar to watch progress: each job shows its stage, how far it has got, and any error. A run is made of steps, and each step reports its own status and duration, so a failure says which part stopped.

Two things slow a first run more than anything else. An extraction that reads a whole table can run out of time; try a shorter period, or fewer objects at once. A large transactional object can exceed its memory budget, which is reported as a request to narrow the period. Neither is a fault in your data. Re-run with a smaller scope, and grow it once you know what each object costs. When the analysis finishes, the run builds its work list: the failing records, ranked worst first, ready for Fix work.

Read the run overview in this order, because the first number misleads on its own.

- The score and its cap. One critical rule failing over tolerance caps an object at 85, two or more at 70. The page names the rules that caused the cap, which is the shortest list worth fixing first.
- The findings, ranked by impact. Impact is failing records multiplied by a severity weight. It is a ranking, not a sum of money.
- The failing records behind a finding, with the field, the current value and, where Meridian has one, a suggested value.

## Coverage badges, and what they mean

Sometimes a rule could not be evaluated, and a coverage badge says so. That is not a pass. A rule may be skipped because it does not apply to your loaded configuration, because the field it reads is not in the extract, or because the system cannot supply what the rule needs. A rule may also be suppressed until a date.

Read coverage before you compare scores. An object at 92 with forty applicable rules measured is a different claim from an object at 92 with six. Coverage names the basis: which rules were counted, over which records. Where coverage is thin, load the system's configuration and re-run, so unmeasured rules stop being invisible rather than being read as clean.

## Comparing two runs

Comparison answers the question a first run cannot: is this better or worse than before?

Open Runs, tick two runs and compare them. Meridian shows which rules and records were fixed, which newly fail, and the score change. Only runs from the same source are comparable: extractions from one system form one lineage, and imported files are grouped by the objects they carry. Pin one run as the baseline to keep it as the reference; comparisons use the baseline when there is one and the previous run otherwise. You can rename a run so a steering pack refers to something a person recognises.

Two honest cautions. Rules that ran in only one of the two runs are left out of the change, so a new rule cannot read as a regression. And records a later run still finds failing return to the open list, which can make the open count rise in a good week.

## Next steps

- Work the records the run found in [Fix work](/fix).
- Check the system behind the run at [Systems](/systems).
- Read the objects the run scored at [Objects](/objects).
