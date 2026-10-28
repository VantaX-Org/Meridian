"use client";

/** Rules, one rule, History: what changed between a version and the one before it (or the shipped rule). */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Async, EmptyState, Pill, Select } from "@/design";
import { LedgerHead } from "@/components/mdm/ledger";
import { diffRows, getRuleVersionDiff, getRuleVersions, type DiffChange } from "@/lib/api/rules";
import { labelOf } from "@/lib/format";

const CHANGE_LABEL: Record<DiffChange, string> = { added: "Added", removed: "Removed" };

/** "shipped@3fa9c2" reads "the shipped rule"; "v2" stays. */
const sideName = (label: string): string => (label.startsWith("shipped@") ? "the shipped rule" : label === "(new rule)" ? "nothing" : label);

export function RuleVersionDiff({ ruleId }: { ruleId: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const versions = useQuery({ queryKey: ["rule-versions", ruleId], queryFn: () => getRuleVersions(ruleId), retry: false });
  const list = versions.data?.versions ?? [];
  // Newest first from the API; the newest is compared until the viewer picks another.
  const version = picked !== null && list.some((v) => v.version === picked) ? picked : list[0]?.version;
  const diff = useQuery({
    queryKey: ["rule-version-diff", ruleId, version],
    queryFn: () => getRuleVersionDiff(ruleId, version as number),
    enabled: version !== undefined,
    retry: false,
  });
  const rows = diff.data ? diffRows(diff.data.diff) : [];

  return (
    <section aria-label="Version changes" className="flex flex-col gap-3">
      <LedgerHead
        title="What changed between versions"
        meta={diff.data ? `${sideName(diff.data.to)} against ${sideName(diff.data.from)}` : "Pick a version to read against the one before it"}
      />
      <Async query={versions} skeleton={96}>{list.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No versions to compare"
          detail={versions.data?.shipped ? "This rule runs as shipped. A change you write appears here as a version." : "Versions appear when the rule is changed."}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label="Version to read"
            value={String(version)}
            onValueChange={(v) => setPicked(Number(v))}
            options={list.map((v) => ({ value: String(v.version), label: `v${v.version}, ${labelOf(v.state).toLowerCase()}` }))}
          />
          <Async query={diff} skeleton={96}>{rows.length === 0 ? (
            <EmptyState variant="inline" title="Nothing differs" detail="This version reads the same as the one before it." />
          ) : (
            <table className="m-table" aria-label="Changed lines">
              <thead>
                <tr>
                  <th scope="col">Change</th>
                  <th scope="col">Line</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${i}-${r.change}`}>
                    <td className="whitespace-nowrap"><Pill tone={r.change === "added" ? "info" : "neutral"}>{CHANGE_LABEL[r.change]}</Pill></td>
                    <td className="whitespace-pre-wrap [overflow-wrap:anywhere]">{r.line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}</Async>
        </div>
      )}</Async>
    </section>
  );
}
