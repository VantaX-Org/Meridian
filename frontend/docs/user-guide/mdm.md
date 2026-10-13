# Master data

Master data management brings records that describe the same real-world thing together, and keeps one trusted version.

## Overview

The overview shows the health of your master data: golden records and their coverage, match confidence, steward SLA compliance, the backlog and how consistent your sources are. Select a tile to open the records behind it.

## Golden records

A golden record is the single best version of an entity, assembled from matching records across systems. Open one to see its fields, the source record each value came from, and its history. Every golden record links back to its sources, so a merge can be explained and reversed.

## Match rules

A match rule compares chosen fields, exactly or fuzzily, and scores how likely two records are the same entity. Pairs above the auto-merge threshold are merged. Pairs in the review band go to a steward. Pairs below it are left alone.

## Survivorship

When sources disagree, survivorship decides which value a golden record keeps for each field: the most recent, the most complete, the trusted system or the most frequent. Rules suggested by AI show an "Inferred by AI" count and only take effect once a person activates them.

## Glossary

The business glossary defines each term, who owns it and which fields it applies to, so everyone uses the same words.

## Stewardship

Merge decisions and golden record reviews arrive in the [inbox](/docs?page=inbox). A steward confirms or rejects each one, and the decision is recorded.

## Duplicates

Insights lists duplicate clusters across objects, so you can decide which to merge first.
