# Getting answers: Ask Meridian, search, tours

Three habits turn Meridian from a tool you visit into a tool that answers you: ask it a question in plain words, jump anywhere from one box, and take the tour once instead of learning by accident. This chapter covers those, plus where the written answers live.

## Ask Meridian, and what it will tell you

The Ask Meridian control sits at the foot of every page. Type a short question in ordinary words: which objects are weakest, what changed since the last run, how many records are still open on one rule, who holds the overdue work. It answers in sentences, with the figures underneath and a link to the page each answer came from.

The important property is where the numbers come from. Every figure in an answer is a figure Meridian already computed for the pages you can open: the same run, the same rules, the same basis. An answer lists the facts it was assembled from and carries links to the checks those facts name, so you can open what the answer rests on rather than take it on trust. When a language model is configured, it may reword those facts, and the answer is then labelled as worded from them. The model is not asked for numbers and never supplies one.

It also refuses. If your figures do not answer the question, it says so plainly and suggests what to ask instead, rather than producing a plausible sentence with an invented number in it. Partial answers are marked as covering part of the question, so you know how much of it was actually matched.

Treat it as a fast route to the right page, not as an authority. If you are going to quote a figure in a report, open the page behind the answer and quote from there: the run is named, the basis is stated, and a colleague can be sent to the same address.

Questions it handles well are comparisons, counts and changes over time. Questions it will not answer are predictions about money, judgements about people, and anything about data outside your scope: what you see is what your role and grants cover.

## Search and jump with the command palette

Press Ctrl K, or `⌘K` on a Mac, anywhere. The palette lists every page your role can open; type part of a name and press Enter. It is the fastest route to a page you know exists.

It also reads what you type with fixed rules, without asking a model anything. A rule ID such as `MM003` opens that rule. An object name opens it. A record key, for example a ten-digit material number, opens that record. A severity or a dimension combined with an object opens that object's rules narrowed to them. Anything it cannot interpret opens the search page, which spans objects, rules, glossary terms, fix batches and runs, exact matches first.

A second box, in the scope bar on every page, does one job better: find a failing record by key or name. Press `/`, type two or more characters, pick a match and the record opens inside its object. It searches the failing records of the run you are viewing, so a record that passes is not listed; for that, search from the object page or the palette.

## Tours, what is new, and the keys

The help menu, marked **?**, offers a guided tour on the pages that have one. Tours are per role: stewards see the queue and the record panel, leads see the verdict and the owners view, Basis sees connections, extraction and configuration loads, process analysts see discovery runs and variants. A tour moves between pages for you and skips steps whose page has nothing to show yet, so take yours after a system is connected rather than before.

Every tour can be replayed. Dismissing one counts as done; the preference page offers a reset that shows them again.

The same menu opens what is new, a short list of what changed in this version with a link to the page each item lives on. Read it after an update: features are switched on quietly, and the release note is the honest way to find out why a page looks different.

And it opens the keyboard shortcuts for the page you are on, which is also `?` pressed on the page itself. The keys worth learning first are the ones for repetitive work: `j` and `k` to move, `a` to accept a suggestion, `t` to take a record, `u` to undo. In the inbox they claim, approve and reject. Keys never fire while you are typing in a box, so nothing goes wrong by leaving the cursor where it is.

## The written answers

The user guide, in the help centre, holds the full guide chapter by chapter, with a printable copy of all of them. It is written for the work, not for the product: each chapter covers one job from start to finish. Open it from the help menu or from [the user guide](/docs), and search it from the palette.

Every statistic carries a hint: hover the small mark beside a number and the definition appears, with a link to the chapter that explains it. That is deliberate, because the four counts of what fails, failing rules, rule failures, failing records and records to fix, measure different things and are routinely confused. When two people disagree about a number, check they are reading the same definition before you compare anything else.

Preferences are worth setting once, at [Me, Preferences](/me/preferences): your time zone so run times and due times read sensibly, your locale, theme and row density. They are stored on the server, so they follow you to any browser and any machine.

## Next steps

- Read the full guide in [the user guide](/docs).
- Search across everything at [Search](/search).
- Set your time zone and density at [Preferences](/me/preferences).
