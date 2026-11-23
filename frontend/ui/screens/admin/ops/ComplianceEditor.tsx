"use client";

import { useState } from "react";
import { putCompliance, RETENTION_FIELD, RETENTION_MAX, RETENTION_MIN, type RetentionFamily, type RetentionInput } from "@/lib/api/v2/enterprise";
import { t } from "@/lib/v2/i18n";
import { Button, Code, Confirm, Field, Input } from "@/ui/kit";
import { Row, useAct } from "./shared";

/** Sets the days each configurable data family is kept (PUT /settings/compliance). A shorter period names what it deletes before it is sent. */
export function ComplianceEditor({ families }: { families: RetentionFamily[] }) {
  const { run, busy } = useAct("compliance", "settings");
  const rows = families.filter((f) => f.configurable && RETENTION_FIELD[f.family]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<RetentionInput | null>(null);
  const val = (f: RetentionFamily) => draft[f.family] ?? (f.days == null ? "" : String(f.days));
  const changes = (): RetentionInput => {
    const out: RetentionInput = {};
    for (const f of rows) if (f.family in draft) out[RETENTION_FIELD[f.family]] = draft[f.family].trim() === "" ? null : Number(draft[f.family]);
    return out;
  };
  const bad = (f: RetentionFamily) => {
    const v = val(f).trim();
    if (v === "") return false;
    const n = Number(v);
    return !Number.isInteger(n) || n < RETENTION_MIN[RETENTION_FIELD[f.family]] || n > RETENTION_MAX;
  };
  const picked = changes();
  const shorter = rows.filter((f) => {
    const v = picked[RETENTION_FIELD[f.family]];
    return v !== undefined && v !== null && (f.days == null || v < f.days);
  });
  const send = (b: RetentionInput) => { setAsk(null); void run(() => putCompliance(b), t("Retention saved")).then((r) => { if (r) setDraft({}); }); };
  return (
    <>
      <Row>
        {rows.map((f) => (
          <Field key={f.family} label={f.label} hint={bad(f) ? t("Whole days from {min} to {max}.", { min: RETENTION_MIN[RETENTION_FIELD[f.family]], max: RETENTION_MAX }) : t("Empty keeps it for ever.")}>
            <Input inputMode="numeric" value={val(f)} onChange={(e) => setDraft({ ...draft, [f.family]: e.target.value })} />
          </Field>
        ))}
        <Button variant="primary" disabled={busy || Object.keys(picked).length === 0 || rows.some(bad)} onClick={() => (shorter.length ? setAsk(picked) : send(picked))}>{t("Save retention")}</Button>
      </Row>
      <Confirm open={!!ask} danger title={t("Keep data for a shorter time?")} confirmLabel={t("Save retention")} cancelLabel={t("Cancel")} onCancel={() => setAsk(null)} onConfirm={() => ask && send(ask)}>
        <p>{t("Older data in these families can be deleted by the nightly task.")}</p>
        <ul>{shorter.map((f) => <li key={f.family}><Code code={f.family} description={f.label} /> {t("to {n} days", { n: String(picked[RETENTION_FIELD[f.family]]) })}</li>)}</ul>
      </Confirm>
    </>
  );
}
