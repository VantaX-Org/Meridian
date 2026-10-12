"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { History } from "lucide-react";
import { Select } from "../primitives/Select";
import { relativeTime } from "../../lib/format";

export interface RunOption {
  id: string;
  label: string;
  /** The system the run was read from; absent for uploads. */
  systemId?: string;
  /** ISO time the run started; shown as relative time beside the picker. */
  at?: string;
}

/** Runs the user may pick: all when `systems` is null, else only runs read from an in-scope system. */
export function runsInScope(runs: RunOption[], systems: ReadonlySet<string> | null | undefined): RunOption[] {
  return systems ? runs.filter((r) => r.systemId !== undefined && systems.has(r.systemId)) : runs;
}

export function RunSelector({ runs: all, systems }: { runs: RunOption[]; systems?: ReadonlySet<string> | null }) {
  const runs = runsInScope(all, systems);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("run") ?? runs[0]?.id ?? "";
  const pinned = current !== (runs[0]?.id ?? ""); // a non-latest run is pinned: accent-soft pill (colour spec 3.6)

  const currentRun = runs.find((r) => r.id === current);
  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("run", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <label
      data-pinned={pinned || undefined}
      className="flex items-center gap-2 px-2 text-[12px] leading-[16px] border"
      style={{ height: "var(--m-control-h)", borderColor: pinned ? "var(--m-accent-soft-2)" : "var(--m-line-strong)", background: pinned ? "var(--m-accent-soft)" : "var(--m-sheet)", borderRadius: "var(--m-radius-control)", color: pinned ? "var(--m-accent-ink)" : "var(--m-ink-3)" }}
    >
      <History size={14} aria-hidden className="lg:hidden" />
      <span className="max-lg:sr-only">Run</span>
      <Select
        value={current}
        onValueChange={onChange}
        options={runs.map((r) => ({ value: r.id, label: r.label }))}
        className="flex h-full items-center justify-between gap-2 border-0 bg-transparent text-[13px] leading-[18px] font-medium max-lg:w-4 max-lg:[&>span]:hidden lg:w-[160px] xl:w-[240px] min-[1440px]:w-[280px]"
      />
      {currentRun?.at && <span className="max-xl:hidden shrink-0 m-numeric">{relativeTime(currentRun.at)}</span>}
    </label>
  );
}
