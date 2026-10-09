"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface RunOption {
  id: string;
  label: string;
}

export function RunSelector({ runs }: { runs: RunOption[] }) {
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
    <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--m-ink-2)" }}>
      Run
      <select
        aria-label="Run"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border px-2 py-1"
        style={{ borderColor: "var(--m-line)" }}
      >
        {runs.map((r) => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>
    </label>
  );
}
