"use client";

import "../step10.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyPolicyPack, unapplyPolicyPack, type Digest, type PolicyPack } from "@/lib/api/v2/step10";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useWaves } from "@/lib/v2/admin-queries";
import { describeCron } from "@/lib/v2/cron";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { audienceWords, CHANNEL_WORD } from "@/lib/v2/step10";
import { refreshStep10, useDigests, usePolicyPacks } from "@/lib/v2/step10-queries";
import { ROLE_NAMES } from "@/lib/v2/view-as";
import { type GridColumn } from "../Grid";
import { ToolGrid } from "../GridTools";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { EmptyFrame, ErrorFrame } from "../parts";
import { PolicyMark } from "../Ruler";
import { AdminPage, Block, Confirm, Loaded, NeedsPermission, StatusWord, useCan } from "./kit";

/** The five coverage numbers of a pack, each with its word. */
export function CoverageList({ p }: { p: Pick<PolicyPack, "coverage"> }) {
  const c = p.coverage;
  const rows: [string, number][] = [
    [t("Fields classified"), c.fields_classified],
    [t("Rules evidencing"), c.rules_evidencing],
    [t("Rules measured"), c.rules_measured],
    [t("Failing records"), c.failing_records],
    [t("Classes breached"), c.classes_breached],
  ];
  return (
    <dl className="m2-s10-cov" data-testid="pack-coverage">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{int(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Applied or not, with who and when, in words. */
export function appliedWords(p: PolicyPack): string {
  if (p.applied) return p.applied_at ? t("Applied {when} by {who}", { when: formatDate(p.applied_at, "date"), who: p.applied_by ?? "—" }) : t("Applied");
  return p.unapplied_at ? t("Not applied since {when}", { when: formatDate(p.unapplied_at, "date") }) : t("Not applied");
}

/** Apply and unapply, with manage_rules. Unapplying asks first: the breaches it counted stop counting at once. */
export function PackActions({ p, scope }: { p: PolicyPack; scope: string }) {
  const qc = useQueryClient();
  const can = useCan()("manage_rules");
  const [confirming, setConfirming] = useState(false);
  const { outcome, pending, run } = useOutcome(scope);
  if (!can) return <p className="m2-prov">{t("Applying or removing a pack needs the manage rules permission.")}</p>;
  const apply = () =>
    void run("apply", async () => {
      const r = await applyPolicyPack(p.id);
      await refreshStep10(qc, "packs");
      return { tone: "ok", title: t("{name} applied", { name: p.name }), detail: t("{n} {n, plural, one {class} other {classes}} now count as policy breaches when one of their critical rules fails.", { n: r.classes ?? p.classes.length }) };
    });
  return (
    <>
      <div className="m2-s10-acts">
        {p.applied ? (
          <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => setConfirming(true)}>
            {t("Remove the pack")}
          </button>
        ) : (
          <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={apply}>
            {pending === "apply" ? t("Applying…") : t("Apply the pack")}
          </button>
        )}
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {confirming ? (
        <Confirm
          title={t("Remove {name}", { name: p.name })}
          body={t("Its classes stop counting as policy breaches on the landscape and the receipt. The rules keep running; you can apply the pack again at any time.")}
          confirm={t("Remove the pack")}
          cancel={t("Keep")}
          pending={pending === "unapply"}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void run("unapply", async () => {
              await unapplyPolicyPack(p.id);
              await refreshStep10(qc, "packs");
              setConfirming(false);
              return { tone: "ok", title: t("{name} removed", { name: p.name }) };
            })
          }
        />
      ) : null}
    </>
  );
}

/** Admin › Policy packs: every pack with its coverage, applied or not, and the way into its classes and evidence. */
export function PolicyPacksSection() {
  const can = useCan();
  const allowed = can("view") || can("manage_rules");
  const q = usePolicyPacks(allowed);
  const { openItem } = useOpenItem();
  if (!allowed) {
    return (
      <AdminPage title={t("Policy packs")}>
        <NeedsPermission what={t("Reading policy packs")} permission="view" />
      </AdminPage>
    );
  }
  return (
    <AdminPage
      title={t("Policy packs")}
      lead={q.data ? t("{applied} of {n} packs applied. An applied pack's classes count as policy breaches on the landscape and the receipt when one of their critical rules fails. Authorities are cited by article or section.", { applied: q.data.applied, n: q.data.packs.length }) : t("GxP, SOX and GDPR field classes, the authority each answers to, and the rules that evidence them.")}
    >
      <Block>
        <Loaded q={q} what={t("The policy packs")} rows={3}>
          {(d) =>
            d.packs.length === 0 ? (
              <EmptyFrame>{t("No policy pack ships with this version.")}</EmptyFrame>
            ) : (
              <ul className="m2-s10-packs" data-testid="policy-packs">
                {d.packs.map((p) => (
                  <li key={p.id} className="m2-s10-pack" data-testid={`pack-${p.id}`}>
                    <h3>
                      {p.name}
                      <StatusWord tone={p.applied ? "go" : "neutral"}>{p.applied ? t("Applied") : t("Not applied")}</StatusWord>
                      {p.applied && p.coverage.classes_breached > 0 ? <PolicyMark mark={{ count: p.coverage.classes_breached, title: t("{count} policy {count, plural, one {class} other {classes}} breached: a critical rule evidencing an applied policy pack fails", { count: p.coverage.classes_breached }) }} /> : null}
                    </h3>
                    <p>{p.authority}</p>
                    <p>{p.description}</p>
                    <CoverageList p={p} />
                    <p className="m2-meta">{appliedWords(p)}</p>
                    <div className="m2-s10-acts">
                      <button type="button" className="m2-btn" onClick={() => openItem({ kind: "policypack", id: p.id })}>
                        {t("Open the classes and evidence")}
                      </button>
                    </div>
                    <PackActions p={p} scope={`pack:${p.id}`} />
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
      </Block>
    </AdminPage>
  );
}

/** Admin › Digests: the scheduled summaries by role or wave, their cadence, channel and last send. */
export function DigestsSection() {
  const can = useCan();
  const allowed = can("manage_settings");
  const q = useDigests(allowed);
  const waves = useWaves(allowed);
  const { openItem, open } = useOpenItem();
  if (!allowed) {
    return (
      <AdminPage title={t("Digests")}>
        <NeedsPermission what={t("Managing digests")} permission="manage_settings" />
      </AdminPage>
    );
  }
  const waveName = (id: string) => waves.data?.find((w) => w.id === id)?.name ?? null;
  const roleName = (r: string) => ROLE_NAMES[r] ?? r;
  const columns: GridColumn<Digest>[] = [
    { id: "name", header: t("Name"), width: 240, pin: true, locked: true, cell: (d) => d.name },
    { id: "for", header: t("For"), width: 240, cell: (d) => audienceWords(d, roleName, waveName) },
    { id: "when", header: t("Cadence"), width: 220, cell: (d) => t("{cadence}, {zone}", { cadence: describeCron(d.cron), zone: d.timezone }) },
    { id: "channel", header: t("Channel"), width: 130, cell: (d) => CHANNEL_WORD[d.channel] ?? d.channel },
    { id: "last", header: t("Last sent"), width: 150, cell: (d) => (d.last_sent_at ? formatDate(d.last_sent_at, "datetime") : t("Never")) },
    { id: "next", header: t("Next"), width: 150, cell: (d) => (d.next_run_at ? formatDate(d.next_run_at, "datetime") : "—") },
    { id: "state", header: t("State"), width: 110, cell: (d) => <StatusWord tone={d.enabled ? "go" : "neutral"}>{d.enabled ? t("On") : t("Paused")}</StatusWord> },
  ];
  const rows = q.data?.digests ?? [];
  return (
    <AdminPage
      title={t("Digests")}
      lead={t("{n} {n, plural, one {digest} other {digests}}. Each one sends the landscape sentence, the score moves, the waves and their gates, the approvals waiting, SLA breaches and the top value at risk, by email, to an alert channel or as a webhook event. Numbers only, never SAP values.", { n: rows.length })}
      actions={
        <button type="button" className="m2-btn m2-next" onClick={() => openItem({ kind: "digest", id: "new" })}>
          {t("Add a digest")}
        </button>
      }
    >
      <Block>
        <ToolGrid<Digest>
          toolsTitle={t("Digests")}
          id="admin-digests"
          ariaLabel={t("Digests")}
          columns={columns}
          rows={rows}
          rowId={(d) => d.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The digests could not be read. {detail}", { detail: apiErrorMessage(q.error) })}</ErrorFrame> : undefined}
          emptyFrame={
            <EmptyFrame
              action={
                <button type="button" className="m2-btn" onClick={() => openItem({ kind: "digest", id: "new" })}>
                  {t("Add a digest")}
                </button>
              }
            >
              {t("No digest yet. Add one for a role, such as the programme lead every Monday, or for a migration wave.")}
            </EmptyFrame>
          }
          onOpen={(d) => openItem({ kind: "digest", id: d.id })}
          openRowId={open?.kind === "digest" ? open.id : null}
        />
      </Block>
    </AdminPage>
  );
}
