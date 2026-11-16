"use client";

import "../admin.css";
import { RuleAccuracySection } from "./accuracy";
import { ADMIN_SECTIONS, isAdminSlug, type AdminSlug } from "@/lib/v2/admin-sections";
import { EmptyFrame, V2Link } from "./parts";
import { ApiKeysSection } from "./apikeys";
import { ConfigBundleSection, DelegationsSection, RulesIoSection, ShareLinksSection, StewardshipSection, ViewAsSection } from "./capabilities";
import { WorkflowsSection } from "./workflows";
import { AuditSection, MappingsSection, ReferenceSection } from "./data";
import { AdminPage, NeedsPermission, useCan } from "./kit";
import { AlertsSection, NotificationsSection } from "./notify";
import { RolesSection } from "./roles";
import { RunsSection } from "./runs";
import { RunSchedulesSection } from "./runschedules";
import { SettingsSection } from "./settings";
import { SsoSection } from "./signin";
import { SystemSection } from "./system";
import { EngineSection } from "./engine";
import { BillingSection, LicenceSection } from "./tenant";
import { UsersSection } from "./users";
import { MatchRulesSection } from "./matchrules";
import { WebhooksSection } from "./webhooks";
import { ContactVerifySection } from "./contactverify";
import { DqFirewallSection } from "./dqfirewall";
import { ExternalDbSection } from "./externaldb";
import { SystemsSection } from "./systems";
import { SubjectRequestsSection } from "./subjectrequests";
import { DigestsSection, PolicyPacksSection } from "./step10";
import { t } from "@/lib/v2/i18n";
import { useAccessRequests, useLicence, useRoles, useUsers } from "@/lib/v2/admin-queries";
import { inviteAttention } from "@/lib/users";
import { int } from "@/lib/v2/score";
import type { Verdict } from "@/lib/api/v2/types";
import { CcBanner, CcHBars, CcPage, type CcFig } from "./cc-parts";

/**
 * The health of the setup in one sentence: the first of an invalid or ending licence, people waiting for access and
 * invitations that need attention, from the reads the Users, Roles and Licence sections already make.
 */
export function AdminHealth({ people, licensed }: { people: boolean; licensed: boolean }) {
  const users = useUsers({}, people).data?.users;
  const requests = useAccessRequests(people).data;
  const roles = useRoles(people).data;
  const read = useLicence().data;
  const licence = licensed ? read : undefined;
  const days = licence?.days_remaining;
  const seats = licence ? (licence.features?.max_users ?? licence.seats ?? null) : null;
  const used = licence?.seats_used ?? users?.filter((u) => u.is_active).length;
  const waiting = requests?.length ?? 0;
  const invites = users ? inviteAttention(users) : { stale: 0, failed: 0 };
  const inviteIssues = invites.stale + invites.failed;

  let verdict: Verdict = "go";
  let headline = t("Nothing in the setup needs attention");
  let why = t("The licence is valid, nobody is waiting for access and every invitation is on its way.");
  let action = people ? { href: "/more/admin/users", label: t("Open users") } : { href: "/more/admin/licence", label: t("Open the licence") };
  if (licence?.valid === false) {
    verdict = "no-go";
    headline = t("The licence is not valid");
    why = t("Module entitlements may be restricted until it is renewed in Meridian HQ.");
    action = { href: "/more/admin/licence", label: t("Open the licence") };
  } else if (days != null && days <= 30) {
    verdict = days <= 7 ? "no-go" : "at-risk";
    headline = t("The licence ends in {n} {days, plural, one {day} other {days}}", { n: int(days), days });
    why = t("Renew it in Meridian HQ before then. The data stays either way.");
    action = { href: "/more/admin/licence", label: t("Open the licence") };
  } else if (waiting > 0) {
    verdict = "at-risk";
    headline = t("{n} {waiting, plural, one {person is} other {people are}} waiting for access", { n: int(waiting), waiting });
    why = t("Each asked from the place they were refused. Grant a role, or decline with a reason.");
    action = { href: "/more/admin/roles", label: t("Answer the access requests") };
  } else if (inviteIssues > 0) {
    verdict = "at-risk";
    headline = t("{n} {inviteIssues, plural, one {invitation needs} other {invitations need}} attention", { n: int(inviteIssues), inviteIssues });
    why = t("They are older than a week, expired or could not be delivered. Resend them or send a link.");
    action = { href: "/more/admin/users", label: t("Open users") };
  }

  const figs: CcFig[] = [];
  if (used != null) figs.push({ label: t("Seats in use"), value: int(used), note: seats ? t("of {n} the licence grants", { n: int(seats) }) : t("no seat limit") });
  if (requests) figs.push({ label: t("Waiting for access"), value: int(waiting), note: t("open requests"), tone: waiting > 0 ? "warn" : undefined });
  if (days != null) figs.push({ label: t("Licence"), value: int(days), note: t("days left") });

  const bars = (roles ?? [])
    .filter((r) => (r.users ?? 0) > 0)
    .sort((a, b) => (b.users ?? 0) - (a.users ?? 0))
    .map((r) => ({
      key: r.key,
      label: (
        <>
          {r.name}
          {r.description ? <span className="nx-reason">{r.description}</span> : null}
        </>
      ),
      value: r.users ?? 0,
      text: t("{n} {users, plural, one {person} other {people}}", { n: int(r.users ?? 0), users: r.users ?? 0 }),
    }));

  return (
    <>
      <CcBanner
        testId="admin-banner"
        label={t("Health of the setup")}
        eyebrow={t("Health of the setup")}
        verdict={verdict}
        headline={headline}
        why={why}
        figs={figs}
        action={
          <V2Link href={action.href} className="nx-btn nx-btn-primary">
            {action.label}
          </V2Link>
        }
      />
      {bars.length > 0 ? (
        <section className="nx-card nx-adm-blk" aria-label={t("People by role")} data-testid="admin-roles-chart">
          <h2 className="nx-kit-h2">{t("People by role")}</h2>
          <p className="nx-reason">{t("Each role with what it is for, and how many people hold it. A person with several roles counts in each.")}</p>
          <CcHBars rows={bars} label={t("People by role")} />
        </section>
      ) : null}
    </>
  );
}

function Section({ slug }: { slug: AdminSlug }) {
  switch (slug) {
    case "users":
      return <UsersSection />;
    case "roles":
      return <RolesSection />;
    case "sso":
      return <SsoSection part="sso" />;
    case "signin":
      return <SsoSection part="signin" />;
    case "apikeys":
      return <ApiKeysSection />;
    case "licence":
      return <LicenceSection />;
    case "billing":
      return <BillingSection />;
    case "settings":
      return <SettingsSection />;
    case "mappings":
      return <MappingsSection />;
    case "reference":
      return <ReferenceSection />;
    case "contactverify":
      return <ContactVerifySection />;
    case "matchrules":
      return <MatchRulesSection />;
    case "audit":
      return <AuditSection />;
    case "alerts":
      return <AlertsSection />;
    case "notifications":
      return <NotificationsSection />;
    case "webhooks":
      return <WebhooksSection />;
    case "subjectrequests":
      return <SubjectRequestsSection />;
    case "externaldb":
      return <ExternalDbSection />;
    case "dqfirewall":
      return <DqFirewallSection />;
    case "policypacks":
      return <PolicyPacksSection />;
    case "digests":
      return <DigestsSection />;
    case "runs":
      return <RunsSection />;
    case "runschedules":
      return <RunSchedulesSection />;
    case "systems":
      return <SystemsSection />;
    case "system":
      return <SystemSection />;
    case "aletheia":
      return <EngineSection />;
    case "stewardship":
      return <StewardshipSection />;
    case "configbundle":
      return <ConfigBundleSection />;
    case "viewas":
      return <ViewAsSection />;
    case "rulesio":
      return <RulesIoSection />;
    case "sharelinks":
      return <ShareLinksSection />;
    case "delegations":
      return <DelegationsSection />;
    case "workflows":
      return <WorkflowsSection />;
    case "ruleaccuracy":
      return <RuleAccuracySection />;
  }
}

/** /admin/<section>: one section in the content pane. */
export function AdminCanvas({ section }: { section: string }) {
  const can = useCan();
  if (!isAdminSlug(section)) {
    return (
      <CcPage dock={false}>
      <AdminPage title={t("Administration")}>
        <EmptyFrame
          action={
            <V2Link href="/more/admin" className="nx-btn">
              {t("All of administration")}
            </V2Link>
          }
        >
          {t("There is no administration section called \"{section}\". {ADMIN_SECTIONSCount} sections exist.", { section, ADMIN_SECTIONSCount: ADMIN_SECTIONS.length })}
        </EmptyFrame>
      </AdminPage>
      </CcPage>
    );
  }
  const meta = ADMIN_SECTIONS.find((x) => x.slug === section)!;
  if (!meta.needs.some((n) => can(n))) {
    return (
      <CcPage dock={false}>
        <AdminPage title={meta.label}>
          <NeedsPermission what={meta.label} permission={meta.needs[0]} />
        </AdminPage>
      </CcPage>
    );
  }
  return (
    <CcPage dock={false}>
      <Section slug={section} />
    </CcPage>
  );
}
