"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { listRequests, type ChangeRequest, type RequestView } from "@/lib/api/v2/requests";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Code, DataTable } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, when } from "../mdm/catalogue/shared";

export const statusText = (s: string): string => ({
  draft: t("Draft"), submitted: t("Submitted"), in_approval: t("In approval"), approved: t("Approved"), rejected: t("Rejected"),
  creating: t("Being created"), created: t("Created"), failed: t("Failed"), cancelled: t("Cancelled"),
} as Record<string, string>)[s] ?? s;
export const kindText = (k: string): string => (k === "create" ? t("New record") : k === "change" ? t("Change") : t("Mass change"));
export const objectText = (o: string): string => ({ material: t("Material"), customer: t("Customer"), vendor: t("Vendor"), business_partner: t("Business partner") } as Record<string, string>)[o] ?? o;

export function RequestsScreen() {
  const router = useRouter();
  const fx = useFixture();
  const [view, setView] = useState<RequestView>("mine");
  const q = useRead(["requests", view], () => listRequests({ view }));
  const rows = q.data?.items ?? [];
  useScreenScope("requests", t("Change requests"), [
    { prompt: t("Which requests are overdue?"), answer: () => ({ text: rows.filter((r) => r.overdue).map((r) => `${r.id} ${r.title ?? ""}`).join(", ") || t("None") }) },
  ]);
  const views: { id: RequestView; label: string }[] = [{ id: "mine", label: t("My requests") }, { id: "to_approve", label: t("To approve") }, { id: "all", label: t("All requests") }];
  return (
    <>
      <Head place="requests" title={t("Change requests")} actions={<>
        <Button variant="secondary" href={withFixture("/requests/analytics", fx)}>{t("Process analytics")}</Button>
        <Button variant="secondary" href={withFixture("/requests/workflows", fx)}>{t("Workflows")}</Button>
        <Button variant="primary" href={withFixture("/requests/new", fx)}>{t("New request")}</Button>
      </>} />
      <div className="mx-tiles" role="group" aria-label={t("Request views")}>
        {views.map((v) => <Chip key={v.id} selected={view === v.id} onClick={() => setView(v.id)}>{v.label}</Chip>)}
      </div>
      <Async q={q}>
        {() => rows.length ? (
          <DataTable<ChangeRequest> label={t("Change requests")} rows={rows} rowKey={(r) => r.id} height={520} onSelect={(r) => router.push(withFixture(`/requests/${encodeURIComponent(r.id)}`, fx))}
            columns={[
              { key: "id", label: t("Request"), sort: (r) => r.id, render: (r) => <Code code={r.id} description={r.title ?? undefined} /> },
              { key: "o", label: t("Object"), sort: (r) => r.object, render: (r) => objectText(r.object) },
              { key: "k", label: t("Type"), render: (r) => kindText(r.kind) },
              { key: "s", label: t("Status"), sort: (r) => r.status, render: (r) => statusText(r.status) },
              { key: "w", label: t("Waiting step"), render: (r) => r.waiting_step ?? t("n/a") },
              { key: "d", label: t("Due"), sort: (r) => r.due_at ?? "", render: (r) => (r.overdue ? `${when(r.due_at)} (${t("overdue")})` : when(r.due_at)) },
              { key: "r", label: t("Records"), align: "end", render: (r) => num(r.record_count) },
              { key: "u", label: t("Requester"), render: (r) => r.requester_label ?? t("n/a") },
            ]} />
        ) : <Empty heading={t("No requests here")} body={t("Create a request to change or add master data.")} />}
      </Async>
    </>
  );
}
