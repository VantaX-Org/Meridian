# Data catalogue

The data catalogue is one place to search and browse every SAP table and field Meridian knows, across every connected system. Open it from the rail, Master data, **Data catalogue**, or type "catalogue" in the command line. The address is `/catalogue`.

## What is on it

- **Search**: type a table (`MARA`), a field (`MEINS`), a table and field together (`MARA-MEINS` or `MARA.MEINS`), words of a description ("gross weight") or the name of a business term. **Look in** chooses **Tables** or **Fields**; **System** narrows the list to one connected system.
- **Tables**: every table with its description, its number of fields, the rules that read it, the objects whose rules read it and the systems that use it. Tables your systems use come first. Choose **Columns** to show **Defined by**: SAP standard, SAP standard with the S/4HANA changes, the system's own dictionary (a customer table) or a cloud system's view such as SuccessFactors.
- **One table**: open a row to see its key, where it is defined, its systems, its objects and the owners of those objects, then the grid of its fields: type, key, the number of rules, the business term and the share of blank values in the newest profile. **All tables** goes back.
- **Fields**: with **Look in** set to Fields, the fields that match the search, each with its table, its type, its rule count and its business term.
- **A field in the inspector**: open any field (`?open=field:MARA.MEINS`). The inspector shows its facts (type, key, mandatory, data element, domain, check table), the SAP help text, the allowed values of its domain, its latest profile with a link to the profile of that run, the rules that check it (with the severity, the object, whether the rule is off for your tenant and its latest pass rate), its business terms with their steward, the objects and systems that use it with their owners, and **Where its values go**: the process steps, processes, S/4 features and KPIs the lineage model draws below it.

## The numbers and where they come from

- Descriptions, types, lengths, keys, check tables and allowed values come from the SAP dictionary Meridian ships (SAP ECC 6.0 standard with the documented S/4HANA changes, and its views of SuccessFactors, Concur and Ariba). When you choose a system that discovery has read, its own dictionary wins, so customer fields and customer tables appear with their own definitions.
- **Rules** are the shipped and tenant rules that read the field, the same columns the check engine reads. A rule your tenant has switched off says so.
- **Systems** are the connected systems where an object that reads the table is enabled, where an analysed run profiled the table, or whose dictionary holds it.
- **Blank** and the profile come from the newest analysed run that profiled the field; with a system chosen, from that system's newest run.
- Business terms and their stewards come from the glossary; owners from the owners set for objects and systems. Nothing on this screen is estimated by a language model.

## What you can do, by role

- **Everyone who can view**: search, browse, open a field, follow a rule, a business term, a profile or a lineage link.
- The catalogue only reads. Rules are changed in the rules library, terms in an object's Glossary tab, owners in Administration.

## Keyboard

- `⌘K` or `/` opens the command line; type "catalogue" to come here.
- In a grid, `j` and `k` or the arrow keys move between rows, `Enter` opens the table or the field, `Esc` closes the inspector.

## When something is wrong

- **A table you expect is missing**: it is neither in the shipped dictionary nor in a discovered dictionary of your systems. Open the system's **Source design** and press **Discover again** so its own tables are read.
- **A field has no profile**: no analysed run has profiled it yet. Profiles are written for the tables an object's rules read when a run is analysed.
- **Systems is empty for a table**: no object that reads it is enabled on a connected system, no run profiled it and no discovered dictionary holds it.
- **"This system is not connected to this tenant"**: the address names a system that is not yours; choose another in **System**.
