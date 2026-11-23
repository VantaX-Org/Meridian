"use client";

import { useState } from "react";
import Link from "next/link";
import { GOLDEN_PAGE, type GoldenRow } from "@/lib/api/v2/mdm";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useGoldenRecords } from "@/lib/v2/mdm-queries";
import { Button, Card, DataTable, EmptyState, ErrorState, FieldChip, PageHeader, SeverityPill, Skeleton, useAletheia, useAletheiaScope, useSheet } from "@/ui/kit";
import { DEFAULT_DOMAIN, DomainSelect, day, pct, statusLabel, useHref } from "./shared";

export function Golden() {
  useInterfaceLang();
  const href = useHref();
  const sheet = useSheet();
  const chat = useAletheia();
  const [domain, setDomain] = useState(DEFAULT_DOMAIN);
  const [page, setPage] = useState(1);
  const q = useGoldenRecords(domain, page);
  const rows = (q.data?.records ?? []) as GoldenRow[];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / GOLDEN_PAGE));
  const pending = rows.reduce((n, r) => n + r.pending_issues, 0);

  useAletheiaScope({
    key: `mdm-golden/${domain}`,
    label: t("Asking about golden records"),
    suggestions: [t("Which golden records need a steward?"), t("How many golden records are promoted?")],
    answer: () => ({
      text: t("{total} golden records for this object. On this page {pending} issues are open across {count} records.", { total, pending, count: rows.length }),
      evidence: [t("Page {page} of {pages}", { page, pages })],
    }),
  });

  const header = (
    <PageHeader
      title={t("Golden records")}
      context={t("{total} records", { total })}
      actions={<Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>}
    />
  );

  return (
    <>
      {header}
      <div className="mx-col">
        <DomainSelect value={domain} onChange={(v) => { setDomain(v); setPage(1); }} />
        {q.isLoading ? <Skeleton lines={8} label={t("Loading golden records")} /> : q.isError ? <ErrorState heading={t("Golden records could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
          <EmptyState heading={t("No golden records yet")} body={t("Golden records appear once matched duplicates are merged or a record is promoted.")} action={<Button href={href("/mdm/match")}>{t("Open match review")}</Button>} />
        ) : (
          <Card title={t("Records")} sub={t("Select a row for a summary. Open the record for fields, history and write-back.")}>
            <DataTable<GoldenRow>
              label={t("Golden records")}
              rows={rows}
              rowKey={(r) => r.id}
              onSelect={(r) => sheet.open("golden", r.id)}
              columns={[
                { key: "key", label: t("Record"), sort: (r) => r.sap_object_key, render: (r) => <Link href={href(`/mdm/golden/${r.id}`)}><FieldChip code={r.sap_object_key} description={r.name ?? undefined} /></Link> },
                { key: "status", label: t("Status"), sort: (r) => r.status, render: (r) => <SeverityPill sev={r.status === "golden" ? "low" : r.status === "superseded" ? "info" : "medium"} label={statusLabel(r.status)} /> },
                { key: "conf", label: t("Confidence"), align: "end", sort: (r) => r.overall_confidence, render: (r) => pct(r.overall_confidence) },
                { key: "src", label: t("Sources"), align: "end", sort: (r) => r.source_count, render: (r) => r.source_count },
                { key: "iss", label: t("Open issues"), align: "end", sort: (r) => r.pending_issues, render: (r) => r.pending_issues },
                { key: "prom", label: t("Promoted"), sort: (r) => r.promoted_at ?? "", render: (r) => day(r.promoted_at) },
              ]}
            />
            <div className="mx-links">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("Previous page")}</Button>
              <span className="mx-muted">{t("Page {page} of {pages}", { page, pages })}</span>
              <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t("Next page")}</Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
