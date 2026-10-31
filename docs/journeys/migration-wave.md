# Journey: migration wave

A wave is a set of objects moved together in one cutover, with a target date, a stage and a gate. The programme lead
fixes a baseline, reads each object's readiness, simulates which fixes would release the wave, drives the work, and
on the day decides go or no-go with a readiness certificate.

- **Roles**: programme lead (analyse, approve), data owners (sign the certificate for their objects), stewards (do
  the fixing, see [find, fix, approve, send](find-fix-approve-send.md)), process analyst (what the blocked process
  steps are).
- **Trigger**: a wave's target date is set, or a mock load is planned.
- **Done**: the wave's verdict is **Go**, the gate is passed, the certificate is issued with its SHA-256 and every
  required signer has signed, and the wave is signed off in the Migration waves panel.
- **Target**: setup in 30 minutes and 12 clicks; the go/no-go decision on the day in 5 minutes and 4 clicks (measured:
  see the [friction audit](friction-audit.md#measured-clicks-against-targets)).

## 1. Baseline

| # | Address | Control | Result |
|---|---|---|---|
| 1.1 | `/runs` | **Runs** in the map; the run to measure against | `/run/{id}` |
| 1.2 | `/run/{id}` | **Pin as baseline** | "Pinned as the baseline. Later runs of this system compare with it by default." |

## 2. Plan the wave and its gate

| # | Address | Control | Result |
|---|---|---|---|
| 2.1 | `/` | **Waves** (the Coverage switch) | `/?view=waves`: each wave with its verdict counts and "Gate not passed, 2 of 3 not met" |
| 2.2 | `/?view=waves&open=waves` | **Edit** on the wave heading | The Migration waves panel, every wave in one form ([F15](friction-audit.md#findings)) |
| 2.3 | same | **Name**, **Target date**, **Stage** (Plan, Mock load 1, Mock load 2, Dress rehearsal, Cutover); **Add a wave**; **Objects** | **Save changes** |
| 2.4 | same | **Gate**: **Min score**, **Zero criticals**, **Contracts met**; **Save the gate** | Each condition with what fails it now ("below 85.0: Accounts payable, Asset accounting, Controlling") |

**Decision**: which conditions. "No gate yet: a wave without one moves on its verdict alone." Contracts met needs an
active data contract naming the objects (People, **Data contracts**).

## 3. Readiness of each object

| # | Address | Control | Result |
|---|---|---|---|
| 3.1 | `/?view=waves` | A no-go object of the wave | `/o/{system}/{object}` |
| 3.2 | `/o/{system}/{object}/readiness` | **Readiness** tab | The dimension chart, the verdict and cap in words, "Migration waves" with blocking gaps and the wave threshold ([F16](friction-audit.md#findings)) |
| 3.3 | `/o/{system}/{object}/processes` | **Processes** tab | Which process steps the data blocks (the process analyst's view) |

## 4. Simulate fixes

| # | Address | Control | Result |
|---|---|---|---|
| 4.1 | `/o/{system}/{object}` | **Simulate fixing…** on the Rules tab | "Simulation: nothing is changed in SAP or in Meridian." The failing rules, ticked |
| 4.2 | same | Untick what will not be fixed in time; **Simulate fixing 10 rules** | The score and verdict the object would have |
| 4.3 | `/o/{system}/{object}/processes` | **What if these rules were fixed**: tick rules | Which process steps would be ready; computed in the browser |

**Hand-off lead to stewards**: the next-step button **Clear the 3 no-go objects in Wave 1: finance foundations**
should open those objects' work ([F14](friction-audit.md#findings)); the lead assigns rows in Work (**Assign…**) or
uses People, **Balance work**. The assignee hears through the **assignment** notice and the weekly digest.

## 5. Go or no-go on the day

| # | Address | Control | Result |
|---|---|---|---|
| 5.1 | `/?view=waves` | **Waves** | The verdict counts and the gate state for the run in the top bar |
| 5.2 | `/?view=waves&open=certificate:{wave}` | **Certificate** on the wave heading | "Not issued", the required signers |
| 5.3 | same | **Issue the certificate** | Issued: each object's score at its latest run, the exceptions and contracts behind it, and a SHA-256; or the reasons it cannot be issued ([F18](friction-audit.md#findings)) |
| 5.4 | Each signer, same address | **Statement (optional)**, **Sign version 1** | "Signed. Waiting for 2 more owners." until every owner has signed; then **Download PDF** |
| 5.5 | `/?view=waves&open=waves` | **Sign off Wave 1: finance foundations** (needs approve; only when the verdict is go) | "Signed off by ... on ..."; any later change to the wave clears it |

**Decision**: go, or no-go with the named objects and rules. "A wave shows every object no-go but scores look close to
target: the cap holds them." Clear the critical rules first.

**Hand-off lead to signers and the steering committee**: the signers need to be told outside the product or by a
comment with `@` on the certificate; the committee gets **Share and export**, **Share this page as a link** (read-only,
expires), or the board pack from Reports.

## Hand-offs at a glance

| From | To | What | How they hear today |
|---|---|---|---|
| Lead | Stewards | Objects to clear | Assignment notice and digest, once rows are assigned |
| Lead | Owners (signers) | Sign the certificate | Not notified by the product; a comment mention or an email |
| Lead | Steering committee | Go or no-go | Share link or board pack |
