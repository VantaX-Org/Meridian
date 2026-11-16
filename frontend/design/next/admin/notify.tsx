"use client";
/* Admin notify group: native sections keyed by admin slug. Admin.tsx checks section.needs before rendering. */
import type { ComponentType } from "react";
import { PolicyPacks } from "../more/PolicyPacks";
import { AlertsSection, NotificationsSectionNative } from "./notify-alerts";
import { DigestsSection } from "./notify-digests";
import { ExternalDbSection } from "./notify-externaldb";
import { DqFirewallSection } from "./notify-firewall";
import { SubjectRequestsSection } from "./notify-subject";
import { WebhooksSection } from "./notify-webhooks";

export { NotificationsSectionNative };

export const NOTIFY_SECTIONS: Record<string, ComponentType> = {
  alerts: AlertsSection,
  notifications: NotificationsSectionNative,
  webhooks: WebhooksSection,
  digests: DigestsSection,
  policypacks: PolicyPacks,
  subjectrequests: SubjectRequestsSection,
  dqfirewall: DqFirewallSection,
  externaldb: ExternalDbSection,
};
