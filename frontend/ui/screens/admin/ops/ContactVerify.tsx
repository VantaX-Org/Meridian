"use client";

import { useQueryClient } from "@tanstack/react-query";
import { putContactVerification } from "@/lib/api/v2/step9";
import { refreshStep9, useContactVerification } from "@/lib/v2/step9-queries";
import { t } from "@/lib/v2/i18n";
import { Card, Code, DataTable, StatTile, Toggle, useToast, EmptyState } from "@/ui/kit";
import { Sec, errText } from "./shared";

export function ContactVerify() {
  const q = useContactVerification();
  const qc = useQueryClient();
  const toast = useToast();
  const rules = q.data?.rules ?? [];
  const mx = q.data?.settings.mx ?? false;
  const bad = rules.reduce((a, r) => a + r.affected, 0);
  const save = async (v: boolean) => {
    try { await putContactVerification(v); toast(t("Setting saved."), "good"); await refreshStep9(qc); } catch (e) { toast(errText(e), "bad"); }
  };
  return (
    <Sec title={t("Contact verification")} scope="contact-verify" q={[q]} context={t("{n} rules", { n: rules.length })}
      facts={[t("{n} contact values fail a check.", { n: bad })]}>
      <dl className="mx-tiles">
        <StatTile label={t("Rules")} value={String(rules.length)} />
        <StatTile label={t("Failing values")} value={String(bad)} />
      </dl>
      <Card title={t("Mail server lookup")} sub={t("When on, an email domain is also checked for a mail server. Only the domain is looked up, never the address.")}>
        <Toggle label={t("Check the mail server of each email domain")} checked={mx} onChange={save} />
      </Card>
      <Card title={t("Contact rules")}>
        {rules.length === 0 ? <EmptyState heading={t("No contact rules apply.")} /> : (
          <DataTable label={t("Contact rules")} rows={rules} rowKey={(r) => r.check_id} height={380}
            columns={[
              { key: "rule", label: t("Rule"), render: (r) => <Code code={r.check_id} description={r.message} /> },
              { key: "module", label: t("Object"), render: (r) => r.module },
              { key: "field", label: t("Field"), render: (r) => r.field ? <Code code={r.field} /> : "" },
              { key: "affected", label: t("Failing"), align: "end", render: (r) => `${r.affected} / ${r.total}`, sort: (r) => r.affected },
              { key: "fixes", label: t("Fixes made"), align: "end", render: (r) => String(r.fixes) },
            ]} />
        )}
      </Card>
    </Sec>
  );
}
