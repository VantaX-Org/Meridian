"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { useV2Href } from "@/lib/v2/hooks";
import type { HealthStatus } from "@/types/api";
import { Button, Chip } from "../kit";
import { SystemsCard } from "./cards";
import { useSheets } from "../shell/SheetHost";
import { ListSearch, LongText, QueryView, VirtualList } from "./states";

export const HEALTH_TONE = { healthy: "good", degraded: "warn", unreachable: "bad", auth_failed: "bad", unknown: "neutral" } as const;
export const healthText = (h: HealthStatus) => ({ healthy: t("Healthy"), degraded: t("Slow"), unreachable: t("Not reachable"), auth_failed: t("Sign-in refused"), unknown: t("Not checked") })[h];

/** Connected systems, each a row that opens its page. Connect a system opens the six-step sheet. */
export function Systems() {
  const q = useSystemsExtended();
  const sheets = useSheets();
  const href = useV2Href();
  const [find, setFind] = useState("");
  const all = useMemo(() => q.data ?? [], [q.data]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? all.filter((s) => `${s.name} ${s.host ?? ""} ${systemTypeText(s.system_type)}`.toLowerCase().includes(n)) : all;
  }, [all, find]);
  const connect = <Button variant="primary" onClick={() => sheets.open({ kind: "connect", id: "new" })}>{t("Connect a system")}</Button>;
  return (
    <div className="nx-body">
      <div className="nx-row">{connect}</div>
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={all.length === 0} emptyHeading={t("No system is connected")} emptyText={t("Connect your first system to start reading data.")} emptyAction={connect} label={t("Loading systems")}>
        <div className="nx-chartcards"><SystemsCard /></div>
        <ListSearch value={find} onChange={setFind} label={t("Search systems")} />
        {shown.length === 0 ? <p className="nx-sub">{t("No system matches this search.")}</p> : (
          <VirtualList rows={shown} rowKey={(s) => s.id} label={t("Systems")} render={(s) => (
            <a className="nx-row nx-link" href={href(`/more/systems/${s.id}`)}>
              <LongText text={s.name} className="nx-row-main" />
              <span className="nx-sub">{systemTypeText(s.system_type)}</span>
              <Chip>{s.environment}</Chip>
              <Chip tone={HEALTH_TONE[s.health_status]}>{healthText(s.health_status)}</Chip>
            </a>
          )} />
        )}
      </QueryView>
    </div>
  );
}
