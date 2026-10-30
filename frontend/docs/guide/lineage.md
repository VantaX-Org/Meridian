# Lineage

Lineage draws why a failing value matters: from the source table, to the field, to the rule that fails on it, to the S/4 feature it blocks or degrades. The **Lineage** tab of an object draws it for the failing rules with the highest value at risk. Open it from the object's tabs, for example `/o/ecc-production/material-master/lineage`.

## What is on it

- **Four columns**: **Source tables** (`MARA`, `MARC`, `MBEW`), **Fields** (`MARA.MEINS`), **Rules** (`MM014`) and **S/4 features** (Migration cockpit: material load, Material ledger actual costing, Embedded EWM product master and so on).
- **Node facts**: "Hover or focus a node to see its facts here. Click a rule or a feature to open it."
- **Export as SVG**: the drawing as a file for a slide or a document.
- The line under it: "Drawn from the 8 failing rules of Material master with the highest value at risk. Features come from the impact model of the current run."

## Related objects

The object header lists the related objects with their relation, **upstream** or **downstream**. An upstream object's failures pass into this one, so the Work ledger and the record inspector say which to fix first, for example "Fix Material master first: 3,640 upstream failures. Records there fail before this object can pass."

## The numbers and where they come from

- The rules drawn are the failing rules of this object in the current run, highest value at risk first.
- The features and whether each is blocked or degraded come from the feature impact rules of the run: the same mapping the Readiness tab shows.

## What you can do, by role

- **Everyone**: read, open a rule or a feature, export as SVG.

## Keyboard

- `Tab` moves through the nodes; the node facts follow the focus. `Enter` opens a rule or a feature.

## When something is wrong

- **The drawing is empty**: no rule of this object fails in the current run, or the object has no run.
- **A feature you expect is missing**: no impact rule maps the failing rules to it. Impact rules are shipped with Meridian; ask your administrator.
