# Legal document templates

**These documents are templates, not final agreements. Have qualified counsel review before presenting to any customer.**

- `EULA.md` — End-user licence agreement for the Meridian software
- `PRIVACY.md` — Privacy policy (HQ portal + customer-side disclosures)
- `DPA.md` — Data processing agreement for GDPR/POPIA article 28 compliance

All three were drafted by engineering, not lawyers. They capture the actual technical reality (single-tenant deployment, on-prem SAP data, cloud licence server only) so counsel has a factually correct starting point rather than a generic SaaS template.

## Checklist before going live

- [ ] Engage counsel to review + finalise
- [ ] Replace every `{{PLACEHOLDER}}` with real values
- [ ] Update the jurisdiction clauses
- [ ] Confirm the retention periods in `PRIVACY.md` match your actual `cron` + backup policy
- [ ] Attach your sub-processor list to `DPA.md` (cloud providers, LLM vendors, payment processor)
- [ ] Publish `PRIVACY.md` on your public website with a version date
