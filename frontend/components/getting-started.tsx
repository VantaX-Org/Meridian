"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Panel, Stack, Text } from "@/components/aurora";
import { getSystems } from "@/lib/api/connectivity";
import { getIssues } from "@/lib/api/issues";
import { useRole } from "@/hooks/use-role";

/**
 * The go-live path, derived from real state — each step is done when the data
 * says so, not when a box is ticked. Hidden once every step is done.
 *
 * Connect → discover → download objects and analyse → review findings. Roles
 * that cannot connect a system (no `manage_systems`) are told who can, instead
 * of being sent to buttons they do not have.
 */
export function GettingStarted({ hasAnalysis }: { hasAnalysis: boolean }) {
  const { can } = useRole();
  const { data: systems = [], isLoading } = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const { data: issues } = useQuery({ queryKey: ["issues", "summary"], queryFn: () => getIssues({ limit: 1 }) });
  const first = systems[0];
  const discovered = systems.find((s) => s.discovery_status === "complete" || s.discovery_status === "partial");
  const worked = Object.entries(issues?.counts ?? {}).some(([k, n]) => k !== "open" && (n ?? 0) > 0);
  const systemHref = first ? `/systems/${first.id}` : "/systems";
  const steps = [
    { done: systems.length > 0, title: "Connect an SAP system", body: "RFC for ECC / S/4HANA / EWM, OData or REST for cloud systems.", href: "/systems" },
    { done: Boolean(discovered), title: "Discover its design", body: "Meridian reads the system's own dictionary, customer extensions and configured values.", href: systemHref },
    { done: hasAnalysis, title: "Download objects and analyse", body: "Pick objects to download into a version (or import a file); every check runs at record level.", href: first ? `${systemHref}?tab=versions` : "/systems" },
    { done: worked, title: "Review findings", body: "See which checks fail and why, then work the failing records: assign, fix in SAP, and let the next version verify the fix.", href: "/findings" },
  ];
  if (steps.every((s) => s.done)) return null;

  if (!isLoading && systems.length === 0 && !can("manage_systems")) {
    return (
      <div style={{ marginBottom: 18 }}>
        <Panel title="Getting to go-live">
          <Text className="font-semibold">Ask an admin to connect a system</Text>
          <Text variant="text-small" tone="secondary" className="mt-1 block">
            No SAP system is connected yet, and connecting one needs an admin or manager. Once a system is connected and
            its objects are analysed, the Data Quality Score and findings appear here.
          </Text>
        </Panel>
      </div>
    );
  }

  const next = steps.findIndex((s) => !s.done);
  return (
    <div style={{ marginBottom: 18 }}>
      <Panel title="Getting to go-live">
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Link href={s.href} className={`block rounded-md border p-3 ${i === next ? "border-[var(--aurora-accent-500)]" : "border-[var(--aurora-canvas-line)]"}`}>
                <Stack direction="row" gap={2} align="center">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] ${s.done ? "bg-[var(--aurora-status-success)] text-white" : "bg-[var(--aurora-elev-2-bg)]"}`}>
                    {s.done ? <Check size={14} /> : i + 1}
                  </span>
                  <Text className="font-semibold">{s.title}</Text>
                </Stack>
                <Text variant="text-small" tone="secondary" className="mt-1 block">{s.body}</Text>
              </Link>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
