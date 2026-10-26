"use client";

/**
 * All features: every page the viewer may open, by area, each with what you do there (lib/nav.ts `featureIndex`,
 * built from the nav so it never drifts), and the ways to start a new run first. An admin sees everything.
 */

import Link from "next/link";
import { Button, Card, PageHeader, Skeleton } from "@/design";
import { RunAnalysis } from "@/app/(app)/insights/_components/RunAnalysis";
import { useNavGate } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { featureIndex, resolveNavHref } from "@/lib/nav";

export default function AllFeaturesPage() {
  const { can, loading, homeRole } = useRole();
  const gate = useNavGate();

  if (loading) return <div aria-busy="true"><Skeleton height={320} /></div>;

  const areas = featureIndex(gate, (href) => resolveNavHref(href, homeRole));
  const starts = [
    can("upload") ? <Button key="import" variant="secondary" render={<Link href="/import">Import a file</Link>} /> : null,
    can("trigger_sync") ? <Button key="extract" variant="secondary" render={<Link href="/systems">Extract from a system</Link>} /> : null,
    can("run_process_discovery") ? <Button key="discover" variant="secondary" render={<Link href="/process/runs?new=1">Run process discovery</Link>} /> : null,
    can("manage_users") ? <Button key="invite" variant="secondary" render={<Link href="/admin/users">Invite a user</Link>} /> : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="All features"
        meta="Every page you can open, by area, and what you do there"
        actions={<RunAnalysis variant="primary" />}
      />
      {starts.length ? (
        <Card title="Start a run">
          <div className="flex flex-wrap gap-2">{starts}</div>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {areas.map(({ area, items }) => (
          <Card key={area} title={area}>
            <ul className="flex flex-col gap-3" aria-label={area}>
              {items.map((item) => (
                <li key={item.href} className="flex items-start gap-2">
                  <item.icon size={16} aria-hidden className="mt-0.5 shrink-0 m-ink-3" />
                  <div className="flex min-w-0 flex-col">
                    <Link href={item.href} className="m-text-body font-semibold m-ink-accent hover:underline underline-offset-2">{item.label}</Link>
                    {item.description ? <span className="m-text-meta m-ink-3">{item.description}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
