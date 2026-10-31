"use client";

import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS, canAdminister, isAdminSlug, visibleSections, type AdminSlug } from "@/lib/v2/admin-sections";
import { EmptyFrame, V2Link } from "../parts";
import { ApiKeysSection } from "./apikeys";
import { ConfigBundleSection, DelegationsSection, RulesIoSection, ShareLinksSection, StewardshipSection, ViewAsSection } from "./capabilities";
import { WorkflowsSection } from "./workflows";
import { AuditSection, MappingsSection, ReferenceSection } from "./data";
import { AdminPage, Block, NeedsPermission, useCan, useUnsavedCount } from "./kit";
import { AlertsSection, NotificationsSection } from "./notify";
import { RolesSection } from "./roles";
import { RunsSection } from "./runs";
import { SettingsSection } from "./settings";
import { SsoSection } from "./signin";
import { SystemSection } from "./system";
import { BillingSection, LicenceSection } from "./tenant";
import { UsersSection } from "./users";
import { WebhooksSection } from "./webhooks";
import { DigestsSection, PolicyPacksSection } from "./step10";
import { t } from "@/lib/v2/i18n";
import { useAccessRequests, useLicence, useRoles, useUsers } from "@/lib/v2/admin-queries";
import { inviteAttention } from "@/lib/users";
import { int } from "@/lib/v2/score";
import type { Verdict } from "@/lib/api/v2/types";
import { CcBanner, CcHBars, CcPage, type CcFig } from "../screens/cc-parts";

/** The places of the landscape map, first in the index so leaving administration is one tap. */
const PLACES: readonly (readonly [string, () => string, string])[] = [
  ["/", () => t("Landscape"), "g l"],
  ["/work", () => t("Work"), "g w"],
  ["/runs", () => t("Runs"), "g r"],
  ["/people", () => t("People"), "g p"],
];

/** The left index of the Admin canvas: the same column as the landscape map, sections in place of objects. */
export function AdminMap({ open, onClose, phone }: { open: boolean; onClose: () => void; phone: boolean }) {
  const pathname = usePathname();
  const can = useCan();
  const sections = visibleSections(can);
  const unsaved = useUnsavedCount();
  const groups = [...new Set(sections.map((s) => s.group))];
  return (
    <aside id="m2-map" className={`m2-map${open ? " m2-open" : ""}`} aria-label={t("Administration")} role={phone && open ? "dialog" : undefined} aria-modal={phone && open ? true : undefined} data-testid="admin-index">
      <div className="m2-map-head">
        <span>{t("Administration")}</span>
        <button type="button" className="m2-x" onClick={onClose} aria-label={t("Close index")}>
          <span className="m2-x-t">{t("Close")}</span>
        </button>
      </div>
      <nav className="m2-mnav" aria-label={t("Administration sections")}>
        {PLACES.map(([href, label, key]) => (
          <V2Link key={href} href={href} className="m2-mi">
            <span>{label()}</span>
            <kbd className="m2-kb">{key}</kbd>
          </V2Link>
        ))}
        <V2Link href="/admin" className="m2-mi" aria-current={pathname === "/admin" ? "page" : undefined}>
          <span>{t("All of administration")}</span>
        </V2Link>
        {groups.map((g) => (
          <div key={g}>
            <div className="m2-adm-grp">{g}</div>
            {sections
              .filter((s) => s.group === g)
              .map((s) => (
                <V2Link key={s.slug} href={`/admin/${s.slug}`} className="m2-mi" aria-current={pathname === `/admin/${s.slug}` ? "page" : undefined}>
                  <span>{s.label}</span>
                  {unsaved > 0 && pathname === `/admin/${s.slug}` ? <span className="m2-dirty" data-testid="index-unsaved">{t("Unsaved")}</span> : null}
                </V2Link>
              ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

/**
 * The health of the setup in one sentence: the first of an invalid or ending licence, people waiting for access and
 * invitations that need attention, from the reads the Users, Roles and Licence sections already make.
 */
function AdminHealth({ people, licensed }: { people: boolean; licensed: boolean }) {
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
  let action = people ? { href: "/admin/users", label: t("Open users") } : { href: "/admin/licence", label: t("Open the licence") };
  if (licence?.valid === false) {
    verdict = "no-go";
    headline = t("The licence is not valid");
    why = t("Module entitlements may be restricted until it is renewed in Meridian HQ.");
    action = { href: "/admin/licence", label: t("Open the licence") };
  } else if (days != null && days <= 30) {
    verdict = days <= 7 ? "no-go" : "at-risk";
    headline = t("The licence ends in {n} {days, plural, one {day} other {days}}", { n: int(days), days });
    why = t("Renew it in Meridian HQ before then. The data stays either way.");
    action = { href: "/admin/licence", label: t("Open the licence") };
  } else if (waiting > 0) {
    verdict = "at-risk";
    headline = t("{n} {waiting, plural, one {person is} other {people are}} waiting for access", { n: int(waiting), waiting });
    why = t("Each asked from the place they were refused. Grant a role, or decline with a reason.");
    action = { href: "/admin/roles", label: t("Answer the access requests") };
  } else if (inviteIssues > 0) {
    verdict = "at-risk";
    headline = t("{n} {inviteIssues, plural, one {invitation needs} other {invitations need}} attention", { n: int(inviteIssues), inviteIssues });
    why = t("They are older than a week, expired or could not be delivered. Resend them or send a link.");
    action = { href: "/admin/users", label: t("Open users") };
  }

  const figs: CcFig[] = [];
  if (used != null) figs.push({ label: t("Seats in use"), value: int(used), note: seats ? t("of {n} the licence grants", { n: int(seats) }) : t("no seat limit") });
  if (requests) figs.push({ label: t("Waiting for access"), value: int(waiting), note: t("open requests") });
  if (days != null) figs.push({ label: t("Licence"), value: int(days), note: t("days left") });

  const bars = (roles ?? [])
    .filter((r) => (r.users ?? 0) > 0)
    .sort((a, b) => (b.users ?? 0) - (a.users ?? 0))
    .map((r) => ({
      key: r.key,
      label: (
        <>
          {r.name}
          {r.description ? <span className="m2-meta">{r.description}</span> : null}
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
          <V2Link href={action.href} className="m2-btn m2-next">
            {action.label}
          </V2Link>
        }
      />
      {bars.length > 0 ? (
        <section className="m2-cc-card" aria-label={t("People by role")} data-testid="admin-roles-chart">
          <h3>{t("People by role")}</h3>
          <p className="m2-cc-lede">{t("Each role with what it is for, and how many people hold it. A person with several roles counts in each.")}</p>
          <CcHBars rows={bars} label={t("People by role")} />
        </section>
      ) : null}
    </>
  );
}

/** /admin: the health of the setup, then every section with the one sentence that says what it is for. */
export function AdminHome() {
  const can = useCan();
  if (!canAdminister(can)) {
    return (
      <CcPage>
        <AdminPage title={t("Administration")}>
          <NeedsPermission what={t("Administration")} permission="manage_settings" />
        </AdminPage>
      </CcPage>
    );
  }
  const sections = visibleSections(can);
  const groups = [...new Set(sections.map((s) => s.group))];
  const shown = new Set(sections.map((s) => s.slug));
  return (
    <CcPage>
    <AdminPage title={t("Administration")} lead={t("Everything that sets up this tenant: who can sign in, what the licence covers, how scoring and alerts behave, and the state of the platform. Each section opens in this column.")}>
      <AdminHealth people={shown.has("users")} licensed={shown.has("licence")} />
      {groups.map((g) => (
        <Block key={g} title={g}>
          <ul className="m2-hlist" aria-label={g}>
            {sections
              .filter((s) => s.group === g)
              .map((s) => (
                <li key={s.slug}>
                  <V2Link href={`/admin/${s.slug}`} className="m2-hitem" style={{ display: "grid" }}>
                    <span className="m2-ht">{s.label}</span>
                    <span className="m2-hs2">{s.lead}</span>
                  </V2Link>
                </li>
              ))}
          </ul>
        </Block>
      ))}
    </AdminPage>
    </CcPage>
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
    case "audit":
      return <AuditSection />;
    case "alerts":
      return <AlertsSection />;
    case "notifications":
      return <NotificationsSection />;
    case "webhooks":
      return <WebhooksSection />;
    case "policypacks":
      return <PolicyPacksSection />;
    case "digests":
      return <DigestsSection />;
    case "runs":
      return <RunsSection />;
    case "system":
      return <SystemSection />;
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
  }
}

/** /admin/<section>: one section in the content pane. */
export function AdminCanvas({ section }: { section: string }) {
  if (!isAdminSlug(section)) {
    return (
      <CcPage>
      <AdminPage title={t("Administration")}>
        <EmptyFrame
          action={
            <V2Link href="/admin" className="m2-btn">
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
  return (
    <CcPage>
      <Section slug={section} />
    </CcPage>
  );
}
