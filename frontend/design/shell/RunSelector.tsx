"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { History } from "lucide-react";
import { Select } from "../primitives/Select";

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
    <label
      className="flex items-center gap-2 px-2 text-[12px] leading-[16px] border"
      style={{ height: "var(--m-control-h)", borderColor: "var(--m-line-strong)", background: "var(--m-sheet)", borderRadius: "var(--m-radius-control)", color: "var(--m-ink-3)" }}
    >
      <History size={14} aria-hidden className="lg:hidden" />
      <span className="max-lg:sr-only">Run</span>
      <Select
        value={current}
        onValueChange={onChange}
        options={runs.map((r) => ({ value: r.id, label: r.label }))}
        className="flex h-full items-center justify-between gap-2 border-0 bg-transparent text-[13px] leading-[18px] font-medium max-lg:w-4 max-lg:[&>span]:hidden lg:w-[160px] xl:w-[200px]"
      />
    </label>
  );
}
