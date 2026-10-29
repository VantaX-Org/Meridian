"use client";

/**
 * Settings › Needs setup: the steps this deployment still lacks, as a to-do in the amber warning tone. Each item reads
 * data the page already has or an API a section below it uses (the licence, the alert channels, the triage calendar,
 * single sign-on), and links to where it is done. Nothing renders once every step is done.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Notice } from "@/design";
import { useRole } from "@/hooks/use-role";
import type { LicenceManifest } from "@/lib/api/licence";
import { getAlertChannels } from "@/lib/api/notifications";
import { getSsoConfig } from "@/lib/api/sso";
import { getTriageSettings } from "@/lib/api/triage";
import { queryKeys } from "@/lib/query-keys";

interface SetupItem {
  key: string;
  label: string;
  detail: string;
  href: string;
  action: string;
  optional?: boolean;
}

export function NeedsSetup({ licence }: { licence: LicenceManifest | undefined }) {
  const { can } = useRole();
  const channels = useQuery({ queryKey: queryKeys.alertChannels(), queryFn: getAlertChannels, enabled: can("manage_settings"), retry: false, meta: { ignoreError: true } });
  const triage = useQuery({ queryKey: queryKeys.triageSettings(), queryFn: getTriageSettings, enabled: can("manage_settings") || can("manage_triage"), retry: false, meta: { ignoreError: true } });
  const sso = useQuery({ queryKey: queryKeys.ssoConfig(), queryFn: getSsoConfig, enabled: can("manage_users"), retry: false, meta: { ignoreError: true } });

  const items: SetupItem[] = [];
  if (can("manage_system") && licence && licence.valid == null) {
    items.push({ key: "licence", label: "Validate the licence", detail: "Until Meridian HQ has checked it, default entitlements apply.", href: "/admin/licence", action: "Open licence" });
  }
  if (channels.isSuccess && channels.data.length === 0) {
    items.push({ key: "alerts", label: "Add an alert channel", detail: "Without one, alerts and digests stay in the app.", href: "/admin/alerts", action: "Add a channel" });
  }
  if (triage.isSuccess && !triage.data.fallback_user_id) {
    items.push({ key: "triage", label: "Set a triage fallback user", detail: "Without one, an issue no rule routes is assigned to nobody.", href: "/admin/triage#calendar", action: "Set fallback user" });
  }
  if (sso.isSuccess && !sso.data.configured) {
    items.push({ key: "sso", label: "Set up single sign-on", detail: "Optional: let people sign in with your identity provider.", href: "/admin/sign-in", action: "Open sign-in", optional: true });
  }
  if (items.length === 0) return null;

  return (
    <Notice tone="warning" title="Needs setup">
      <ul className="flex flex-col gap-2" aria-label="Setup steps">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span>
              <span className="font-medium m-ink">{i.label}</span>
              <span className="m-ink-2">{`. ${i.detail}`}</span>
            </span>
            <Link href={i.href} className="whitespace-nowrap font-medium underline m-ink-accent-ink">{i.action}</Link>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
