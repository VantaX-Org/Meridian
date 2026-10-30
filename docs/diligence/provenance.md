# Provenance

How the code in this repository was produced, who wrote it, what that means for the intellectual property a
buyer acquires, what history is available, and how changes are reviewed. Written in answer to finding DR-5 of
the buyer's critique (provenance and key-person risk).

## 1. How the code was produced

Meridian was built with AI-assisted development: Claude Code, an AI coding agent, wrote most of the code
and documents under the direction and review of one principal engineer, Reshigan Govender, who set the
product, the architecture and the acceptance criteria, reviewed the work and merged it. Claude Code ran
inside the company's own development environment and repositories; its commits carry the author name
"Claude" or a `Co-Authored-By` trailer naming Claude Code's address (`noreply@anthropic.com`).

Measured on the history visible in this clone at commit `b97a7722` (the commit the critique reviewed):

```bash
git log b97a7722 --format=%an | sort | uniq -c | sort -rn
```

| Author name in git | Commits | Of which carry a Claude Code co-author trailer |
|---|---|---|
| Claude | 357 | (authored by Claude Code) |
| Reshigan Govender | 147 | 2 |
| Reshigan | 147 | 111 |
| DiphekoK / Diphekok | 4 | 4 |
| **Total** | **655** | |

- "Reshigan Govender" and "Reshigan" are the same person (the principal engineer) committing from
  different machines and from GitHub; together 294 commits. 101 of them are pull-request merges into
  `main` (subjects ending in a PR number such as `(#533)`), many of which squash work done with Claude Code.
- 474 of the 655 commits (72%) name Claude Code as author or co-author; the other 181 were authored by
  the principal engineer with no AI attribution recorded. The share of lines written by Claude Code is
  higher than the share of commits, because the large feature commits are AI-assisted; it was not
  measured line by line.
- A second human contributor (GitHub user `DiphekoK`) authored 4 commits, all AI-assisted: a PDF report
  restyle, a Docker build fix, an installer script fix and a connectivity fix.
- The commits use six author email addresses: the AI agent's, the principal engineer's company address,
  his GitHub no-reply address, an address at another organisation's domain (160 commits), and the second
  contributor's GitHub no-reply and personal addresses.
- Time: 1 visible commit in August 2026, 4 in September, 650 in October. The visible window adds about
  2.17 million lines and removes about 0.26 million, including generated files (DDIC-derived rules,
  fixtures, SBOMs, translation catalogues, help material).

## 2. What this means for IP

- **Authorship and direction.** Everything in the repository was written by the principal engineer, by
  the second contributor, or by Claude Code operating on the company's instructions in the company's
  repositories. No code was copied in from another product; third-party code is limited to declared
  dependencies (see [licences.md](licences.md) and `THIRD_PARTY_NOTICES.md`). The one third-party brand
  element on screen, the Aletheia mark, is explained in [licences.md](licences.md) section 6.
- **What a buyer should ask for, and what we recommend giving:**
  1. A written IP assignment to the selling entity from every human contributor: the principal engineer
     and `DiphekoK`. The principal engineer's commits under another organisation's email domain need a
     confirmation from that organisation (or from the engineer, with evidence) that it claims no rights in
     the work.
  2. A representation on AI-generated code: that the code was generated with Claude Code under the
     company's direction and review; that the company holds whatever rights the provider's terms of service
     grant to the user in the output; that no prompt or instruction directed the reproduction of
     third-party code; and that the third-party licences in the SBOMs are complete. Counsel should check the
     provider's terms in force when the code was written and the position on copyright in AI-assisted
     works in the relevant jurisdictions, which is unsettled in some of them.
  3. A licence scan of the source itself (not only the dependencies) for verbatim third-party code, if the
     buyer's policy requires it. None has been run for this package.
- **Key-person risk.** One person directed and reviewed all of it. A buyer should expect a retention
  arrangement for the principal engineer and a hand-over period; the documents in this package, the debt
  register and the CI gates are written so another team can take over, but none has yet.

## 3. History available

This clone is shallow: the visible history starts at a cut-off commit dated 19 August 2026
(`git rev-parse --is-shallow-repository` prints `true`), so earlier history is not visible here. The full,
unshallow repository (all branches, tags and pull requests on GitHub under `VantaX-Org`) is available on
request, and we recommend depositing it in escrow at signing so the buyer can verify authorship back to the
first commit. A full history will also show the commits outside the visible window, which this document
has not counted.

## 4. How changes are reviewed

- **Human review.** The principal engineer reviews every change before it reaches `main`; work lands
  through pull requests (101 merges in the visible window). There is no second human reviewer, which is
  part of the key-person risk.
- **CI gates on every pull request** (`.github/workflows/`, detailed in [quality.md](quality.md) section 2):
  the whole pytest suite in six shards against Postgres 16 and Redis 7, rule reconciliation with the SAP
  field dictionary, generated-rule freshness, TypeScript strict compile, ESLint with zero warnings,
  Vitest with coverage floors, the design-token lint, the translation gate, colour contrast, Playwright
  specs against the production build, RLS integration tests, dependency and image scans, SBOM drift, and
  an installer smoke test.
- **Tests.** 505 Python test files (18,292 collected items, of which 10,109 are generated per-rule proofs),
  121 Vitest files and 18 Playwright spec files (17 in the test project, one that records the help videos). The Playwright specs run in fixture mode against stubbed API
  responses (DR-1).
- **Acceptance run.** On 30 October 2026 the product was brought up on a live local stack and walked as
  every role on synthetic data: 18 of 21 browser steps and 66 of 66 API checks passed, and the defects
  found were fixed in separate commits (`frontend/docs/acceptance-2026-10.md`, commit `d49301fd` on the
  backend remediation branch, not yet merged into this branch).
- **Gaps** a buyer should weigh: whole-suite Python coverage has not been measured, Python lint and type
  checks are not yet CI gates, and no full-stack end-to-end test runs in CI (see
  [quality.md](quality.md) and the register).
