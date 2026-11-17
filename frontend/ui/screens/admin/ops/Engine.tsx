"use client";

import { useQuery } from "@tanstack/react-query";
import { getEngineDrivers, type EngineOffReason } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { useEngineStatus } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Card, Code, DataTable, StatTile } from "@/ui/kit";
import { Sec, day } from "./shared";

const off = (r?: EngineOffReason) => ({
  too_few_runs: t("Too few runs to learn from yet."), not_configured: t("The engine is not set up."), unreachable: t("The engine cannot be reached."),
  no_token: t("The engine has no access token."), licence_invalid: t("The engine licence is not valid."), engine_error: t("The engine returned an error."),
}[r ?? "engine_error"]);

export function Engine() {
  const q = useEngineStatus();
  const fx = useFixture();
  const drv = useQuery({ queryKey: ["v2", "engine-drivers", fx], queryFn: getEngineDrivers, retry: false });
  const s = q.data;
  const d = drv.data;
  const counters = Object.entries(s?.usage?.counters ?? {});
  return (
    <Sec title={t("Aletheia engine")} scope="engine" q={[q]} context={s?.version ? t("Version {v}", { v: s.version }) : undefined}
      facts={[s?.live ? t("The engine is live.") : t("The engine is not live.")]}>
      <dl className="mx-tiles">
        <StatTile label={t("State")} value={s?.live ? t("Connected") : s?.configured ? t("Not reachable") : t("Not set up")} />
        <StatTile label={t("Access token")} value={s?.token_set ? t("Set") : t("Missing")} />
        <StatTile label={t("Licence")} value={s?.licence?.valid ? t("Valid") : s?.licence?.licensed === false ? t("None") : t("Not valid")} note={s?.licence?.expires ? t("Expires {d}", { d: day(s.licence.expires) }) : s?.licence?.reason ?? undefined} />
        <StatTile label={t("Tenant")} value={s?.tenant ?? ""} />
      </dl>
      {counters.length > 0 && (
        <Card title={t("Usage")}>
          <DataTable label={t("Engine usage")} rows={counters} rowKey={([k]) => k} height={200}
            columns={[{ key: "k", label: t("Counter"), render: ([k]) => <Code code={k} /> }, { key: "v", label: t("Count"), align: "end", render: ([, v]) => String(v) }]} />
        </Card>
      )}
      <Card title={t("Normal ranges")} sub={t("Learned from the run history. Only scores and counts reach the engine.")}>
        {!d?.available ? <p className="mx-muted">{off(d?.reason)}</p> : (
          <DataTable label={t("Normal ranges")} rows={d.ranges ?? []} rowKey={(r) => r.metric} height={260}
            columns={[
              { key: "m", label: t("Measure"), render: (r) => <Code code={r.metric} description={d.labels[r.metric]} /> },
              { key: "lo", label: t("Low"), align: "end", render: (r) => String(r.low ?? "") },
              { key: "hi", label: t("High"), align: "end", render: (r) => String(r.high ?? "") },
              { key: "now", label: t("Latest"), align: "end", render: (r) => `${r.latest ?? ""}${r.outside ? ` (${t("outside range")})` : ""}` },
            ]} />
        )}
      </Card>
      {d?.available && (d.links ?? []).length > 0 && (
        <Card title={t("Lead and lag links")}>
          <DataTable label={t("Lead and lag links")} rows={d.links ?? []} rowKey={(r) => `${r.source}>${r.target}`} height={220}
            columns={[
              { key: "s", label: t("Leads"), render: (r) => <Code code={r.source} description={d.labels[r.source]} /> },
              { key: "t", label: t("Follows"), render: (r) => <Code code={r.target} description={d.labels[r.target]} /> },
              { key: "lag", label: t("Lag (runs)"), align: "end", render: (r) => String(r.lag ?? "") },
              { key: "c", label: t("Correlation"), align: "end", render: (r) => String(r.correlation ?? "") },
            ]} />
        </Card>
      )}
    </Sec>
  );
}
