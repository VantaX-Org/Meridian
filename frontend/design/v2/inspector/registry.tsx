"use client";

import type { ComponentType, ReactNode } from "react";
import type { OpenItem, OpenKind } from "@/lib/v2/hooks";
import dynamic from "next/dynamic";
import { InspectorSkeleton } from "../parts";
import { t } from "@/lib/v2/i18n";

/**
 * Every inspector body loads when it is first opened, not with the page: the shell carries none of their code. While
 * one arrives the inspector's frame is already there, with the skeleton of its title and facts.
 */
function InspectorLoading() {
  return (
    <aside className="m2-insp" id="m2-inspector" aria-label={t("Inspector")} aria-busy="true" data-testid="inspector-loading">
      <div className="m2-insp-d">
        <InspectorSkeleton />
      </div>
    </aside>
  );
}

const BatchInspector = dynamic<BodyProps>(() => import("./batch").then((m) => m.BatchInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const InboxPanel = dynamic<BodyProps>(() => import("./inbox").then((m) => m.InboxPanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const JobInspector = dynamic<BodyProps>(() => import("./job").then((m) => m.JobInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const PersonInspector = dynamic<BodyProps>(() => import("./person").then((m) => m.PersonInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const PreferencesPanel = dynamic<BodyProps>(() => import("./panels").then((m) => m.PreferencesPanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const HelpPanel = dynamic<BodyProps>(() => import("./panels").then((m) => m.HelpPanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const ApiKeyInspector = dynamic<BodyProps>(() => import("./people").then((m) => m.ApiKeyInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const RoleInspector = dynamic<BodyProps>(() => import("./people").then((m) => m.RoleInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const UserInspector = dynamic<BodyProps>(() => import("./people").then((m) => m.UserInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const AuditInspector = dynamic<BodyProps>(() => import("./records").then((m) => m.AuditInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const ChannelInspector = dynamic<BodyProps>(() => import("./records").then((m) => m.ChannelInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const MappingInspector = dynamic<BodyProps>(() => import("./records").then((m) => m.MappingInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const ReportInspector = dynamic<BodyProps>(() => import("./reports").then((m) => m.ReportInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const ScheduleInspector = dynamic<BodyProps>(() => import("./reports").then((m) => m.ScheduleInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const WavesPanel = dynamic<BodyProps>(() => import("./waves").then((m) => m.WavesPanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const RunInspector = dynamic<BodyProps>(() => import("./run").then((m) => m.RunInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const SystemInspector = dynamic<BodyProps>(() => import("./system").then((m) => m.SystemInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const TriagePanel = dynamic<BodyProps>(() => import("./triage").then((m) => m.TriagePanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const GoldenInspector = dynamic<BodyProps>(() => import("./golden").then((m) => m.GoldenInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const TermInspector = dynamic<BodyProps>(() => import("./term").then((m) => m.TermInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const FeatureInspector = dynamic<BodyProps>(() => import("./feature").then((m) => m.FeatureInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const StepInspector = dynamic<BodyProps>(() => import("./step").then((m) => m.StepInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const ConnectionInspector = dynamic<BodyProps>(() => import("./connection").then((m) => m.ConnectionInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const ConfigInspector = dynamic<BodyProps>(() => import("./config").then((m) => m.ConfigInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const SyncScheduleInspector = dynamic<BodyProps>(() => import("./schedule").then((m) => m.ScheduleInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const ZObjectInspector = dynamic<BodyProps>(() => import("./zobject").then((m) => m.ZObjectInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const SurvivorshipInspector = dynamic<BodyProps>(() => import("./survivorship").then((m) => m.SurvivorshipInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const BalancePanel = dynamic<BodyProps>(() => import("./balance").then((m) => m.BalancePanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const ContractInspector = dynamic<BodyProps>(() => import("./contract").then((m) => m.ContractInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const ContractsPanel = dynamic<BodyProps>(() => import("./contract").then((m) => m.ContractsPanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const OutOfOfficePanel = dynamic<BodyProps>(() => import("./delegation").then((m) => m.OutOfOfficePanel as ComponentType<BodyProps>), { loading: InspectorLoading });
const CertificateInspector = dynamic<BodyProps>(() => import("../screens/step9/Certificate").then((m) => m.CertificateInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const DeliveryInspector = dynamic<BodyProps>(() => import("./webhook").then((m) => m.DeliveryInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const WebhookInspector = dynamic<BodyProps>(() => import("./webhook").then((m) => m.WebhookInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const DigestInspector = dynamic<BodyProps>(() => import("./step10").then((m) => m.DigestInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const PolicyPackInspector = dynamic<BodyProps>(() => import("./step10").then((m) => m.PolicyPackInspector as ComponentType<BodyProps>), { loading: InspectorLoading });
const RequestInspector = dynamic<BodyProps>(() => import("./request").then((m) => m.RequestInspector as ComponentType<BodyProps>), { loading: InspectorLoading });

interface BodyProps {
  id: string;
  onClose: () => void;
}

/**
 * The inspector kinds whose body lives in its own file: `?open=<kind>:<id>` picks the component here. Each draws its
 * own frame (title, status line, body). Kinds not listed fall through to Inspector.tsx.
 */
export const INSPECTOR_BODIES: Partial<Record<OpenKind, ComponentType<BodyProps>>> = {
  run: RunInspector,
  system: SystemInspector,
  job: JobInspector,
  batch: BatchInspector,
  request: RequestInspector,
  person: PersonInspector,
  inbox: InboxPanel,
  triage: TriagePanel,
  golden: GoldenInspector,
  term: TermInspector,
  feature: FeatureInspector,
  step: StepInspector,
  user: UserInspector,
  role: RoleInspector,
  apikey: ApiKeyInspector,
  audit: AuditInspector,
  channel: ChannelInspector,
  mapping: MappingInspector,
  report: ReportInspector,
  schedule: ScheduleInspector,
  preferences: PreferencesPanel,
  help: HelpPanel,
  waves: WavesPanel,
  connection: ConnectionInspector,
  config: ConfigInspector,
  syncschedule: SyncScheduleInspector,
  zobject: ZObjectInspector,
  survivorship: SurvivorshipInspector,
  contract: ContractInspector,
  contracts: ContractsPanel,
  balance: BalancePanel,
  away: OutOfOfficePanel,
  webhook: WebhookInspector,
  delivery: DeliveryInspector,
  certificate: CertificateInspector,
  policypack: PolicyPackInspector,
  digest: DigestInspector,
};

export function extensionFor(item: OpenItem, onClose: () => void): ReactNode {
  const Body = INSPECTOR_BODIES[item.kind];
  return Body ? <Body key={`${item.kind}:${item.id}`} id={item.id} onClose={onClose} /> : null;
}
