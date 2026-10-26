"use client";

/**
 * Admin › All features: every page the signed-in admin may open, by section (lib/nav.ts `featureIndex`), with the
 * ways to start work first. Pages that are tabs of another page or live in a menu (insight tabs, notifications,
 * preferences) are listed too, so nothing under app/(app) is out of reach.
 */

import Link from "next/link";
import { Button, Card, EmptyState, PageHeader, Skeleton } from "@/design";
import { RunAnalysis } from "@/app/(app)/insights/_components/RunAnalysis";
import { useNavGate } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { featureIndex, resolveNavHref } from "@/lib/nav";

export default function AllFeaturesPage() {
  const { can, loading, homeRole } = useRole();
  const gate = useNavGate();

  if (loading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (!can("manage_users")) {
    return (
      <EmptyState
        title="Only administrators see the feature index"
        detail="Every page you can open is in the menu and the More panel."
        ghost="list"
        action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />}
      />
    );
  }

  const sections = featureIndex(gate, (href) => resolveNavHref(href, homeRole));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="All features"
        meta="Every page in Meridian, by section, and the ways to start a new run"
        actions={<RunAnalysis variant="primary" />}
      />
      <Card title="Start a run">
        <div className="flex flex-wrap gap-2">
          {can("upload") ? <Button variant="secondary" render={<Link href="/import">Import a file</Link>} /> : null}
          {can("trigger_sync") ? <Button variant="secondary" render={<Link href="/systems">Extract from a system</Link>} /> : null}
          {can("run_process_discovery") ? <Button variant="secondary" render={<Link href="/process/runs?new=1">Run process discovery</Link>} /> : null}
          {can("manage_users") ? <Button variant="secondary" render={<Link href="/admin/users">Invite a user</Link>} /> : null}
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((s) => (
          <Card key={s.group} title={s.group}>
            <ul className="flex flex-col gap-2" aria-label={s.group}>
              {s.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="inline-flex items-center gap-2 m-text-body m-ink-accent underline underline-offset-2">
                    <item.icon size={16} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
