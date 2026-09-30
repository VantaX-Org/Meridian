"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Panel, Stack, Text } from "@/components/aurora";
import { getSystems } from "@/lib/api/connectivity";
import { getIssues } from "@/lib/api/issues";

/**
 * The go-live path, derived from real state — each step is done when the data
 * says so, not when a box is ticked. Hidden once every step is done.
 */
export function GettingStarted({ hasAnalysis }: { hasAnalysis: boolean }) {
  const { data: systems = [] } = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const { data: issues } = useQuery({ queryKey: ["issues", "summary"], queryFn: () => getIssues({ limit: 1 }) });
  const first = systems[0];
  const discovered = systems.find((s) => s.discovery_status === "complete" || s.discovery_status === "partial");
  const worked = Object.entries(issues?.counts ?? {}).some(([k, n]) => k !== "open" && (n ?? 0) > 0);
  const steps = [
    { done: systems.length > 0, title: "Connect an SAP system", body: "RFC for ECC / S/4HANA / EWM, OData or REST for cloud systems.", href: "/systems" },
    { done: Boolean(discovered), title: "Discover its design", body: "Meridian reads the system's own dictionary, customer extensions and configured values.", href: first ? `/systems/${first.id}` : "/systems" },
    { done: hasAnalysis, title: "Run the first analysis", body: "Extract modules (or upload a file); every check runs at record level.", href: first ? `/systems/${first.id}` : "/upload" },
    { done: worked, title: "Work the failing records", body: "Assign, fix in SAP, and let the next run verify the fix.", href: "/issues" },
  ];
  if (steps.every((s) => s.done)) return null;
  const next = steps.findIndex((s) => !s.done);
  return (
    <div data-theme="light" style={{ marginBottom: 18 }}>
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
