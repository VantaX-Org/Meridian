"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { testSystemConnection } from "@/lib/api/v2/runs";
import { runKeys, useSystemsExtended } from "@/lib/v2/runs-queries";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, useAletheia, useAletheiaScope, useTab, useToast } from "@/ui/kit";
import { ConfigTab } from "./ConfigTab";
import { CustomTab } from "./CustomTab";
import { DesignTab } from "./DesignTab";
import { ExtractionsTab } from "./ExtractionsTab";
import { PilotTab } from "./PilotTab";
import { ReferenceTab } from "./ReferenceTab";
import { Health, envLabel, errMsg, typeLabel, when } from "./shared";

const TABS = ["extractions", "design", "config", "pilot", "reference", "custom"] as const;

export function System({ id }: { id: string }) {
  useInterfaceLang();
  const fx = useFixture();
  const href = (p: string) => withFixture(p, fx);
  const q = useSystemsExtended();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useAletheia();
  const [tab, setTab] = useTab(TABS, "extractions");
  const [busy, setBusy] = useState(false);
  const sys = q.data?.find((s) => s.id === id);

  useAletheiaScope({
    key: `system-${id}`,
    label: t("Asking about {name}", { name: sys?.name ?? t("this system") }),
    suggestions: [t("Is this system healthy?"), t("When did it last sync?")],
    answer: (prompt) => (prompt === t("When did it last sync?")
      ? { text: t("Last sync: {when}.", { when: when(sys?.last_sync_at) }) }
      : { text: t("Health: {h}.", { h: sys?.health_status ?? t("unknown") }) }),
  });

  if (q.isLoading) return <Skeleton lines={8} label={t("Loading the system")} />;
  if (q.isError) return <ErrorState heading={t("This system could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  if (!sys) return <EmptyState heading={t("System not found")} body={t("It may have been removed.")} action={<Button variant="primary" href={href("/s")}>{t("Back to systems")}</Button>} />;

  const test = async () => {
    setBusy(true);
    try {
      const r = await testSystemConnection(id);
      toast(r.connected ? t("{name} answered.", { name: sys.name }) : t("{name} did not answer: {why}", { name: sys.name, why: r.message }), r.connected ? "good" : "bad");
      await qc.invalidateQueries({ queryKey: runKeys.systems(fx) });
    } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  const label: Record<(typeof TABS)[number], string> = {
    extractions: t("Extractions"), design: t("Design"), config: t("Configuration"), pilot: t("Pilot"), reference: t("Reference files"), custom: t("Custom objects"),
  };
  return (
    <>
      <PageHeader
        title={sys.name}
        context={`${typeLabel(sys.system_type)} - ${envLabel(sys.environment)}`}
        actions={<>
          <Health value={sys.health_status} />
          <Button variant="secondary" disabled={busy} onClick={() => void test()}>{busy ? t("Testing") : t("Test connection")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
          <Button variant="ghost" href={href("/s")}>{t("All systems")}</Button>
        </>}
      />
      <Tabs idBase="system" label={t("System sections")} items={TABS.map((x) => ({ id: x, label: label[x] }))} value={tab} onChange={(id) => setTab(id as typeof tab)} />
      <div role="tabpanel" id={`system-panel-${tab}`} aria-labelledby={`system-tab-${tab}`}>
        {tab === "extractions" ? <ExtractionsTab id={id} source={sys.role !== "target"} /> : null}
        {tab === "design" ? <DesignTab id={id} /> : null}
        {tab === "config" ? <ConfigTab id={id} /> : null}
        {tab === "pilot" ? <PilotTab id={id} /> : null}
        {tab === "reference" ? <ReferenceTab id={id} /> : null}
        {tab === "custom" ? <CustomTab id={id} /> : null}
      </div>
    </>
  );
}
