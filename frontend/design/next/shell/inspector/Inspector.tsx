"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import { useOpenItem, type OpenKind } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { EmptyState, Skeleton } from "../../kit";
import { AskBodyNative } from "../AskBodyNative";
import { InspectorFrame, type BodyProps } from "./frame";

type Bodies = Record<string, ComponentType<BodyProps>>;
interface GroupProps extends BodyProps {
  kind: string;
}

/** While a group's code arrives the inspector already shows where it will be, with the skeleton of its facts. */
function InspectorLoading() {
  return (
    <aside id="m2-inspector" aria-label={t("Inspector")} aria-busy="true" data-testid="inspector-loading">
      <Skeleton lines={4} />
    </aside>
  );
}

/** Every group of bodies loads when one of its kinds is first opened, not with the shell. */
const group = (load: () => Promise<Bodies>) =>
  dynamic<GroupProps>(
    () =>
      load().then((bodies) => {
        function Group({ kind, ...props }: GroupProps) {
          const Body = bodies[kind];
          return Body ? <Body {...props} /> : <Nothing {...props} />;
        }
        return Group;
      }),
    { loading: InspectorLoading },
  );

const Reports = group(() => import("./reports").then((m) => m.REPORTS_BODIES));
const Run = group(() => import("./run").then((m) => m.RUN_BODIES));
const People = group(() => import("./people").then((m) => m.PEOPLE_BODIES));
const Work = group(() => import("./work").then((m) => m.WORK_BODIES));

function AskPanelNative({ onClose }: BodyProps) {
  return (
    <InspectorFrame title={t("Ask Meridian")} status={t("Answers use only this run's facts. The model rewords them; any number that is not a fact is refused.")} onClose={onClose}>
      <AskBodyNative />
    </InspectorFrame>
  );
}

/** `?open=<kind>:<id>` picks the group here. Kinds not listed get the plain frame. */
/** `?open=<kind>:<id>` picks the group here. Kinds not listed get the plain frame. */
export const INSPECTOR_GROUPS: Partial<Record<OpenKind, ComponentType<GroupProps>>> = {
  run: Run,
  ...Object.fromEntries(["user", "role", "apikey", "audit", "channel"].map((k) => [k, People])),
  ...Object.fromEntries(["job", "batch", "request", "step", "person", "certificate"].map((k) => [k, Work])),
  ...Object.fromEntries(["report", "schedule", "webhook", "delivery", "policypack", "digest"].map((k) => [k, Reports])),
};

function Nothing({ id, onClose }: BodyProps) {
  return (
    <InspectorFrame title={id} status={t("Feature")} onClose={onClose}>
      <EmptyState heading={t("This selection has nothing more to show. Close the inspector and choose a row.")} />
    </InspectorFrame>
  );
}

/** Shell slot: the right-hand inspector, driven by `?open=<kind>:<id>`. Renders nothing when nothing is open. */
export function Inspector() {
  const { open, close } = useOpenItem();
  if (!open) return null;
  if (open.kind === "ask") return <AskPanelNative id={open.id} onClose={close} />;
  const Group = INSPECTOR_GROUPS[open.kind];
  if (Group) return <Group key={`${open.kind}:${open.id}`} kind={open.kind} id={open.id} onClose={close} />;
  return <Nothing id={open.id} onClose={close} />;
}
