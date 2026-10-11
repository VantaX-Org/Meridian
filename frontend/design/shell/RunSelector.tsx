"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "../primitives/Select";

export interface RunOption {
  id: string;
  label: string;
  /** The system the run was read from; absent for uploads. */
  systemId?: string;
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

  const onChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("run", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <label className="flex items-center gap-2 text-[12px] leading-[16px]" style={{ color: "var(--m-ink-3)" }}>
      Run
      <Select
        value={current}
        onValueChange={onChange}
        options={runs.map((r) => ({ value: r.id, label: r.label }))}
        className="flex w-[220px] h-8 items-center justify-between gap-2 rounded border px-3 text-[13px]"
      />
    </label>
  );
}
