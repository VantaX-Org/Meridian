"use client";

import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Card, EmptyState, PageHeader } from "@/ui/kit";
import { canAny, useCan, useSectionChat } from "./common";
import { SECTIONS, isSection } from "./sections";

/** The sections this viewer may open, grouped in the order they are registered. */
export function Admin() {
  useInterfaceLang();
  const fx = useFixture();
  const can = useCan();
  const open = Object.values(SECTIONS).filter((s) => canAny(can, s.needs));
  const groups = [...new Set(open.map((s) => s.group()))];
  useSectionChat("index", t("Administration"), [
    t("You can open {n} of {total} administration sections.", { n: open.length, total: Object.keys(SECTIONS).length }),
  ], [t("What can I administer?")]);
  return (
    <div className="mx-col">
      <PageHeader title={t("Administration")} context={t("People, tenant settings and integrations.")} />
      {open.length === 0 ? (
        <EmptyState heading={t("You have no administration access")} body={t("Ask a tenant administrator for access to the sections you need.")} />
      ) : groups.map((g) => (
        <Card key={g} title={g}>
          <ul className="mx-links">
            {open.filter((s) => s.group() === g).map((s) => (
              <li key={s.slug}>
                <a href={withFixture(`/n/admin/${s.slug}`, fx)}><strong>{s.label()}</strong></a>
                <p className="mx-muted">{s.lead()}</p>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/** One section by slug; an unknown slug or a missing permission shows an honest empty state. */
export function AdminSectionScreen({ slug }: { slug: string }) {
  useInterfaceLang();
  const can = useCan();
  if (!isSection(slug)) return <EmptyState heading={t("There is no such section")} body={t("Pick one from the administration index.")} />;
  const s = SECTIONS[slug];
  if (!canAny(can, s.needs)) return <EmptyState heading={t("You do not have access to {section}", { section: s.label() })} body={t("Ask a tenant administrator for access.")} />;
  const Screen = s.Screen;
  return <Screen />;
}
