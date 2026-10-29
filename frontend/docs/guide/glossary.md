# Glossary

The glossary is the shared language of an object: one business term per SAP field, with its definition, its owner, its status and the rules that cite it. The **Glossary** tab of an object lists its terms and the fields that still have none. Open it from the object's tabs, for example `/v2/o/ecc-production/material-master/glossary`.

## What is on it

- **Search terms** and **Add terms from the rule library**.
- **Business terms**: "6 terms", each with term, definition, SAP field (`MARA-MEINS`), owner, status (**Active** or **Under review**) and rules. For example: "Base unit of measure: The unit in which stock of the material is managed. Every other unit is converted to it."
- The line under the table: "Owner is the owner of the material master object. Rules counts the rules that cite the term."
- **Fields without a term**: the fields read by failing rules that have no term yet, each with the rule that reads it, for example `MBEW.BKLAS` and `MM091`. "The fields are those read by the failing rules of this object in the latest run. Terms are drafted from the rule library with Add terms from the rule library, and a data owner approves each."

## The term inspector

Open a term for its definition, **Fields this term governs**, **Rules that cite this term**, its review cycle and when it was last reviewed, and its history ("The change is in the term's history."). **Mark as reviewed** keeps an active term current. "Editing and approving a term needs the approve permission. A data owner can do both." Approving moves a term from **Under review** to **Active**.

## The numbers and where they come from

- **Rules** counts the rules that cite the term.
- **Fields without a term** comes from the failing rules of the latest run, so it changes as rules start or stop failing.

## What you can do, by role

- **Data owner** (approve): edit, approve and mark terms as reviewed.
- **Data steward**: draft terms with Add terms from the rule library, comment on terms.
- **Everyone**: read, search, comment, export.

## Keyboard

- `j` and `k` move, `Enter` opens a term.
- `Esc` closes the inspector.

## When something is wrong

- **A term stays Under review**: it waits for the object's owner. People shows who owns the object.
- **No owner shown**: the object has no owner yet. Administration, Stewardship lists the gaps.
- **A field is missing from Fields without a term**: only fields read by failing rules are listed.
