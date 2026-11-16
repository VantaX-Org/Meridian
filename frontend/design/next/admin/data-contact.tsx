"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { putContactVerification, type ContactRule } from "@/lib/api/v2/step9";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { refreshStep9, useContactVerification } from "@/lib/v2/step9-queries";
import { Mono, V2Link } from "@/design/v2/parts";
import { Chip, Code, DataTable, EmptyState } from "../kit";
import { DataBlock, DataLoaded, DataPage, Toggle, useAct, useCan } from "./data-parts";

type Sample = ContactRule["samples"][number];

function MxSwitch({ mx, can }: { mx: boolean; can: boolean }) {
  const qc = useQueryClient();
  const [on, setOn] = useState(mx);
  const { pending, act } = useAct();
  return (
    <Toggle
      checked={on}
      disabled={!can || pending !== null}
      label={t("Check that each email domain has a mail server")}
      hint={t("Asks this site's own DNS resolver, once per domain, at the next run. Only the domain is asked, never the address. When the resolver does not answer, no address fails.")}
      onChange={(v) => {
        setOn(v);
        void act("save", async () => {
          await putContactVerification(v);
          await refreshStep9(qc, "automation");
          return v ? t("Mail server check on from the next run") : t("Mail server check off");
        }).then((ok) => (ok ? undefined : setOn(!v)));
      }}
    />
  );
}

function RuleBlock({ r }: { r: ContactRule }) {
  const reasons = Object.entries(r.reasons).map(([code, x]) => ({ code, ...x }));
  return (
    <DataBlock title={r.message} hint={[moduleText(r.module), r.check_id, r.field].filter(Boolean).join(", ")} testid={`contact-rule-${r.check_id}`}>
      <p className="nx-sub">
        <Chip tone={r.affected === 0 ? "good" : "warn"}>{r.affected === 0 ? t("All {n} values pass", { n: int(r.total) }) : t("{a} of {n} values fail", { a: int(r.affected), n: int(r.total) })}</Chip>
        {r.checked_at ? ` ${t("Checked {when}", { when: formatDate(r.checked_at) })}` : null}
      </p>
      {reasons.length ? (
        <DataTable<(typeof reasons)[number]>
          caption={t("Reasons")}
          rows={reasons}
          rowKey={(x) => x.code}
          rowLabel={(x) => x.text}
          columns={[
            { id: "reason", label: t("Reason"), cell: (x) => <Code code={x.code} text={x.text} /> },
            { id: "records", label: t("Records"), align: "end", cell: (x) => int(x.count), compare: (a, b) => a.count - b.count },
          ]}
        />
      ) : null}
      {r.samples.length ? (
        <DataTable<Sample>
          caption={t("Records and why each fails")}
          rows={r.samples}
          rowKey={(s) => s.record_key}
          rowLabel={(s) => s.record_key}
          columns={[
            { id: "record", label: t("Record"), cell: (s) => <Code code={s.record_key} /> },
            { id: "value", label: t("Value"), cell: (s) => <Mono>{s.value || "—"}</Mono> },
            { id: "why", label: t("Why it fails"), cell: (s) => s.reason_text ?? "—" },
          ]}
        />
      ) : null}
      {r.fixes ? (
        <p className="nx-sub">
          {t("{n, plural, one {# proposed fix waits} other {# proposed fixes wait}} in the cleansing queue.", { n: r.fixes })} <V2Link href="/cleansing">{t("Open cleansing")}</V2Link>
        </p>
      ) : null}
    </DataBlock>
  );
}

/** Admin › Contact verification: email, phone and address results per rule, each failing record with its own reason. */
export function ContactVerifySection() {
  const can = useCan();
  const q = useContactVerification();
  return (
    <DataPage lead={t("Email syntax and disposable domains, phone numbers by country, and postal codes, cities and regions against the uploaded postal list. Everything runs on this site; no address leaves it.")}>
      <DataLoaded q={q} what={t("The contact verification results")}>
        {(d) => (
          <>
            <DataBlock title={t("Mail server check")}>
              <MxSwitch key={String(d.settings.mx)} mx={d.settings.mx} can={can("manage_settings")} />
            </DataBlock>
            {d.rules.length === 0 ? <EmptyState heading={t("No contact results yet. They appear after the next run of business partner, customer or Employee Central.")} /> : d.rules.map((r) => <RuleBlock key={r.check_id} r={r} />)}
          </>
        )}
      </DataLoaded>
    </DataPage>
  );
}
