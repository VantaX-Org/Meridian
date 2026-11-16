"use client";

import { t } from "@/lib/v2/i18n";
import { Skeleton } from "@/ui/kit";
import { useObjectRun } from "@/ui/screens/object/useObjectRun";
import { Fixes } from "./Fixes";
import { Glossary } from "./Glossary";
import { Golden } from "./Golden";
import { Lineage } from "./Lineage";
import { ProcessDesign } from "./ProcessDesign";
import { Processes } from "./Processes";
import { Profile } from "./Profile";
import { Readiness } from "./Readiness";
import { Record } from "./Record";
import { Records } from "./Records";
import { Rules } from "./Rules";
import { Runs } from "./Runs";
import { TabFrame, type Tab } from "./TabFrame";
import { Trend } from "./Trend";

const TITLE: Record<Tab, () => string> = {
  records: () => t("Records"), record: () => t("Record"), trend: () => t("Trend"), runs: () => t("Runs"), fixes: () => t("Fixes"),
  rules: () => t("Rules"), golden: () => t("Golden records"), glossary: () => t("Glossary"), lineage: () => t("Lineage"),
  profile: () => t("Profile"), readiness: () => t("Readiness"), processes: () => t("Processes"), design: () => t("Process designer"),
};

/** One object sub-screen: the shared run context, the frame, and the body for `tab`. */
export function Screen({ tab, system, module, recordKey }: { tab: Tab; system: string; module: string; recordKey?: string }) {
  const o = useObjectRun(system, module);
  // Data keys are underscored (dqs_summary, rules); `objectPath` hyphenates again for URLs.
  const p = { o, system, module: o.module };
  const body = {
    records: <Records {...p} />, record: <Record {...p} recordKey={recordKey ?? ""} />, trend: <Trend {...p} />, runs: <Runs {...p} />,
    fixes: <Fixes {...p} />, rules: <Rules {...p} />, golden: <Golden {...p} />, glossary: <Glossary {...p} />, lineage: <Lineage {...p} />,
    profile: <Profile {...p} />, readiness: <Readiness {...p} />, processes: <Processes {...p} />, design: <ProcessDesign {...p} />,
  }[tab];
  const loading = o.runsLoading && tab !== "readiness" && tab !== "golden" && tab !== "glossary" && tab !== "design";
  // Records and Record draw their own frame (they add header actions), so the wrapper steps aside once loaded.
  if (!loading && (tab === "records" || tab === "record")) return body;
  return <TabFrame {...p} tab={tab} title={TITLE[tab]()}>{loading ? <Skeleton lines={5} label={t("Loading the run")} /> : body}</TabFrame>;
}
