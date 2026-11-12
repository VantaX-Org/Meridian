"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { putContactVerification, type ContactRule } from "@/lib/api/v2/step9";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { refreshStep9, useContactVerification } from "@/lib/v2/step9-queries";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { EmptyFrame, Mono, V2Link } from "../parts";
import { AdminPage, Block, Loaded, StatusWord, Sw, useCan } from "./kit";

function MxSwitch({ mx, can }: { mx: boolean; can: boolean }) {
  const qc = useQueryClient();
  const [on, setOn] = useState(mx);
  const { outcome, pending, run } = useOutcome("contact-mx");
  return (
    <>
      <Sw
        checked={on}
        disabled={!can || pending !== null}
        label={t("Check that each email domain has a mail server")}
        hint={t("Asks this site's own DNS resolver, once per domain, at the next run. Only the domain is asked, never the address. When the resolver does not answer, no address fails.")}
        onChange={(v) => {
          setOn(v);
          void run("save", async () => {
            await putContactVerification(v);
            await refreshStep9(qc, "automation");
            return { tone: "ok", title: v ? t("Mail server check on from the next run") : t("Mail server check off") };
          });
        }}
      />
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

function RuleBlock({ r }: { r: ContactRule }) {
  const reasons = Object.entries(r.reasons);
  return (
    <Block title={r.message} hint={[moduleText(r.module), r.check_id, r.field].filter(Boolean).join(", ")}>
      <p className="m2-prov">
        <StatusWord tone={r.affected === 0 ? "go" : "at-risk"}>
          {r.affected === 0 ? t("All {n} values pass", { n: int(r.total) }) : t("{a} of {n} values fail", { a: int(r.affected), n: int(r.total) })}
        </StatusWord>
        {r.checked_at ? ` ${t("Checked {when}", { when: formatDate(r.checked_at) })}` : null}
      </p>
      {reasons.length ? (
        <div className="m2-frame" tabIndex={0}>
          <table className="m2-tbl" aria-label={t("Reasons")}>
            <thead>
              <tr>
                <th scope="col">{t("Reason")}</th>
                <th scope="col" className="m2-r">{t("Records")}</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map(([code, x]) => (
                <tr key={code}>
                  <th scope="row">{x.text}</th>
                  <td className="m2-r">{int(x.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {r.samples.length ? (
        <div className="m2-frame" tabIndex={0}>
          <table className="m2-tbl" aria-label={t("Records and why each fails")}>
            <thead>
              <tr>
                <th scope="col">{t("Record")}</th>
                <th scope="col">{t("Value")}</th>
                <th scope="col">{t("Why it fails")}</th>
              </tr>
            </thead>
            <tbody>
              {r.samples.map((s) => (
                <tr key={s.record_key}>
                  <th scope="row"><Mono>{s.record_key}</Mono></th>
                  <td><Mono>{s.value || "—"}</Mono></td>
                  <td>{s.reason_text ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {r.fixes ? (
        <p className="m2-prov">
          {t("{n, plural, one {# proposed fix waits} other {# proposed fixes wait}} in the cleansing queue.", { n: r.fixes })}{" "}
          <V2Link href="/cleansing">{t("Open cleansing")}</V2Link>
        </p>
      ) : null}
    </Block>
  );
}

/** Admin › Contact verification: email, phone and address results per rule, each failing record with its own reason. */
export function ContactVerifySection() {
  const can = useCan();
  const q = useContactVerification();
  return (
    <AdminPage
      title={t("Contact verification")}
      lead={t("Email syntax and disposable domains, phone numbers by country, and postal codes, cities and regions against the uploaded postal list. Everything runs on this site; no address leaves it.")}
    >
      <Loaded q={q} what={t("The contact verification results")}>
        {(d) => (
          <>
            <Block title={t("Mail server check")}>
              <MxSwitch key={String(d.settings.mx)} mx={d.settings.mx} can={can("manage_settings")} />
            </Block>
            {d.rules.length === 0 ? (
              <EmptyFrame>{t("No contact results yet. They appear after the next run of business partner, customer or Employee Central.")}</EmptyFrame>
            ) : (
              d.rules.map((r) => <RuleBlock key={r.check_id} r={r} />)
            )}
          </>
        )}
      </Loaded>
    </AdminPage>
  );
}
