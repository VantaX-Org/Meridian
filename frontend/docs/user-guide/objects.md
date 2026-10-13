# Objects

An object is a business entity such as a business partner, a material or a GL account. Objects is where you find out what is wrong with each one and what it blocks.

## The explorer

Every object in the selected run is listed with its score, a Go, At risk or Not ready verdict, its failing checks and the records affected. The tiles above the table count objects by verdict. Select any number to open the rows behind it.

## The data quality score

The score averages record-level pass rates across six dimensions: completeness and accuracy count 25% each, consistency 20%, and timeliness, uniqueness and validity 10% each. Select the score ring to see each dimension, its weight and the five rules costing the most.

One critical failing rule caps the score at 85, and two or more at 70. The page shows the measured value, the cap and the rules that caused it.

## One object

An object page has four tabs:

1. **Overview** shows the score by dimension and the headline counts.
2. **Rules** lists the rules that run on this object, worst first. Filter by severity or dimension, or show only blocking rules.
3. **Fields** profiles each table and field.
4. **Records** lists the failing records for one rule, with their values.

## Findings and the drawer

Select a finding to open its drawer: what failed, how many records, why it matters, sample records, a suggested fix and, where the data allows, the root cause: bad data, bad configuration or both.

## Records

Open a record to see all its fields. From a failing record you can open the fix sheet and propose a correction. Press `f` on the records tab to open the fix sheet for the focused row.
