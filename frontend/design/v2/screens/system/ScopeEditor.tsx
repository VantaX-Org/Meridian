"use client";

import type { ScopeKey } from "@/lib/api/system-objects";
import { dateError, SCOPE_LABEL, scopeSentence, buildScope, type ScopeDraft } from "@/lib/v2/extract-scope";
import { labelOf } from "@/lib/format";
import { Field } from "../../forms";
import { t } from "@/lib/v2/i18n";

/**
 * The extraction scope, inline: the organisational filters (company codes, plants, sales and purchasing organisations)
 * that the chosen objects accept, the date window for the transactional ones, and whether records flagged for deletion
 * are skipped. Organisational filters restrict every table that carries the field; general data without it is read in
 * full so no record loses its context.
 */
export function ScopeEditor({ draft, onChange, filters, windowed, windowObjects }: { draft: ScopeDraft; onChange: (d: ScopeDraft) => void; filters: ScopeKey[]; windowed: boolean; windowObjects: string[] }) {
  const err = dateError(draft.date_from, draft.date_to);
  return (
    <div className="m2-scope" data-testid="scope-editor">
      <h3>{t("Scope")}</h3>
      {filters.length === 0 && !windowed ? <p className="m2-prov">{t("The chosen objects accept no organisational filter. They are read in full.")}</p> : null}
      <div className="m2-grid2">
        {filters.map((k) => (
          <Field key={k} label={SCOPE_LABEL[k]} hint={t("Comma-separated. Empty reads all.")}>
            {(p) => <input {...p} value={draft.lists[k] ?? ""} placeholder="1000, 2000" onChange={(e) => onChange({ ...draft, lists: { ...draft.lists, [k]: e.target.value } })} />}
          </Field>
        ))}
        {windowed ? (
          <>
            <Field label={t("Documents from")} hint={t("Replaces the default window for {map}", { map: windowObjects.map(labelOf).join(", ") })}>
              {(p) => <input {...p} type="date" value={draft.date_from} onChange={(e) => onChange({ ...draft, date_from: e.target.value })} />}
            </Field>
            <Field label={t("Documents to")} error={err}>
              {(p) => <input {...p} type="date" value={draft.date_to} onChange={(e) => onChange({ ...draft, date_to: e.target.value })} />}
            </Field>
          </>
        ) : null}
      </div>
      <label className="m2-chk">
        <input type="checkbox" checked={draft.exclude_deleted} onChange={(e) => onChange({ ...draft, exclude_deleted: e.target.checked })} />
        {t("Skip records flagged for deletion")}
      </label>
      <p className="m2-fhint">{t("Faster reads. Leave off for a full quality score, because inactive data is itself a finding.")}</p>
      <p className="m2-prov" data-testid="scope-sentence">{scopeSentence(buildScope(draft, filters, windowed))}</p>
    </div>
  );
}
