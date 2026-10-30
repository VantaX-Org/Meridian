"use client";

import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS, canAdminister, isAdminSlug, visibleSections, type AdminSlug } from "@/lib/v2/admin-sections";
import { EmptyFrame, V2Link } from "../parts";
import { ApiKeysSection } from "./apikeys";
import { ConfigBundleSection, DelegationsSection, RulesIoSection, ShareLinksSection, StewardshipSection, ViewAsSection } from "./capabilities";
import { AuditSection, MappingsSection, ReferenceSection } from "./data";
import { AdminPage, Block, NeedsPermission, useCan } from "./kit";
import { AlertsSection, NotificationsSection } from "./notify";
import { RolesSection } from "./roles";
import { RunsSection } from "./runs";
import { SettingsSection } from "./settings";
import { SsoSection } from "./signin";
import { SystemSection } from "./system";
import { BillingSection, LicenceSection } from "./tenant";
import { UsersSection } from "./users";
import { WebhooksSection } from "./webhooks";
import { t } from "@/lib/v2/i18n";

/** The left index of the Admin canvas: the same column as the landscape map, sections in place of objects. */
export function AdminMap({ open, onClose, phone }: { open: boolean; onClose: () => void; phone: boolean }) {
  const pathname = usePathname();
  const can = useCan();
  const sections = visibleSections(can);
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
        <V2Link href="/v2" className="m2-mi">
          <span>{t("Back to the landscape")}</span>
          <kbd className="m2-kb">g l</kbd>
        </V2Link>
        <V2Link href="/v2/admin" className="m2-mi" aria-current={pathname === "/v2/admin" ? "page" : undefined}>
          <span>{t("All of administration")}</span>
        </V2Link>
        {groups.map((g) => (
          <div key={g}>
            <div className="m2-adm-grp">{g}</div>
            {sections
              .filter((s) => s.group === g)
              .map((s) => (
                <V2Link key={s.slug} href={`/v2/admin/${s.slug}`} className="m2-mi" aria-current={pathname === `/v2/admin/${s.slug}` ? "page" : undefined}>
                  <span>{s.label}</span>
                </V2Link>
              ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

/** /v2/admin: every section with the one sentence that says what it is for. */
export function AdminHome() {
  const can = useCan();
  if (!canAdminister(can)) {
    return (
      <AdminPage title={t("Administration")}>
        <NeedsPermission what={t("Administration")} permission="manage_settings" />
      </AdminPage>
    );
  }
  const sections = visibleSections(can);
  const groups = [...new Set(sections.map((s) => s.group))];
  return (
    <AdminPage title={t("Administration")} lead={t("Everything that sets up this tenant: who can sign in, what the licence covers, how scoring and alerts behave, and the state of the platform. Each section opens in this column.")}>
      {groups.map((g) => (
        <Block key={g} title={g}>
          <ul className="m2-hlist" aria-label={g}>
            {sections
              .filter((s) => s.group === g)
              .map((s) => (
                <li key={s.slug}>
                  <V2Link href={`/v2/admin/${s.slug}`} className="m2-hitem" style={{ display: "grid" }}>
                    <span className="m2-ht">{s.label}</span>
                    <span className="m2-hs2">{s.lead}</span>
                  </V2Link>
                </li>
              ))}
          </ul>
        </Block>
      ))}
    </AdminPage>
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
  }
}

/** /v2/admin/<section>: one section in the content pane. */
export function AdminCanvas({ section }: { section: string }) {
  if (!isAdminSlug(section)) {
    return (
      <AdminPage title={t("Administration")}>
        <EmptyFrame
          action={
            <V2Link href="/v2/admin" className="m2-btn">
              {t("All of administration")}
            </V2Link>
          }
        >
          {t("There is no administration section called \"{section}\". {ADMIN_SECTIONSCount} sections exist.", { section, ADMIN_SECTIONSCount: ADMIN_SECTIONS.length })}
        </EmptyFrame>
      </AdminPage>
    );
  }
  return <Section slug={section} />;
}
