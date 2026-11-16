"use client";

import { useState } from "react";
import { getLinks, getLinkTypes, type LinkType, type RecordLink } from "@/lib/api/v2/links";
import { t } from "@/lib/v2/i18n";
import { Card, Code, DataTable, Field, Input, Split } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, when } from "./shared";

export function LinksScreen() {
  const [domain, setDomain] = useState("");
  const [key, setKey] = useState("");
  const links = useRead(["links", domain, key], () => getLinks({ domain: domain || undefined, key: key || undefined }));
  const types = useRead(["link-types"], getLinkTypes);
  useScreenScope("links", t("Links"), [
    { prompt: t("How many links did AI infer?"), answer: () => {
      const n = (links.data?.relationships ?? []).filter((l) => l.ai_inferred).length;
      return { text: `${n} ${t("of")} ${links.data?.total ?? 0}` };
    } },
  ]);
  return (
    <>
      <Head title={t("Links")} context={links.data ? `${num(links.data.total)} ${t("links")}` : undefined} />
      <Split leftLabel={t("Links")} rightLabel={t("Link types")}
        left={
          <>
            <Card title={t("Find links of a record")}>
              <Field label={t("Domain")}><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="material_master" /></Field>
              <Field label={t("Record key")}><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="000000000000000123" /></Field>
            </Card>
            <Async q={links}>
              {(d) => (d.relationships.length ? (
                <DataTable<RecordLink> label={t("Links")} rows={d.relationships} rowKey={(l) => l.id} height={420}
                  columns={[
                    { key: "from", label: t("From"), sort: (l) => l.from_key, render: (l) => <><Code code={l.from_domain} /> {l.from_key}</> },
                    { key: "type", label: t("Type"), render: (l) => <Code code={l.relationship_type} description={l.sap_link_table ?? undefined} /> },
                    { key: "to", label: t("To"), sort: (l) => l.to_key, render: (l) => <><Code code={l.to_domain} /> {l.to_key}</> },
                    { key: "ai", label: t("Inferred"), render: (l) => (l.ai_inferred ? t("Yes") : t("No")) },
                    { key: "seen", label: t("Found"), render: (l) => when(l.discovered_at) },
                  ]} />
              ) : <Empty heading={t("No links found")} />)}
            </Async>
          </>
        }
        right={
          <Async q={types}>
            {(d) => (d.length ? (
              <Card title={t("Link types")}>
                <DataTable<LinkType> label={t("Link types")} rows={d} rowKey={(x) => x.id} height={420}
                  columns={[
                    { key: "from", label: t("From table"), render: (x) => <Code code={x.from_table} /> },
                    { key: "type", label: t("Type"), render: (x) => <Code code={x.relationship_type} description={x.description ?? undefined} /> },
                    { key: "to", label: t("To table"), render: (x) => <Code code={x.to_table} /> },
                  ]} />
              </Card>
            ) : <Empty heading={t("No link types")} />)}
          </Async>
        } />
    </>
  );
}
