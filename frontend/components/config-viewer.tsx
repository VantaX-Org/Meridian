"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Table, Database } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { getConfigSnapshot } from "@/lib/api/connectivity";
import { relativeTime } from "@/lib/format";
import type { ConfigSnapshot } from "@/types/api";

interface ConfigViewerProps {
  systemId: string;
  modules: string[];
}

function ConfigTableAccordion({
  systemId,
  module,
}: {
  systemId: string;
  module: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["config-snapshot", systemId, module],
    queryFn: () => getConfigSnapshot(systemId, module),
    enabled: expanded,
  });

  return (
    <div className="border border-black/[0.08] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/[0.50] transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Table className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">{module}</span>
        </div>
        {data && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] border-black/[0.08]">
              {data.record_count} records
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                data.source === "live"
                  ? "border-[#16A34A]/20 text-[#16A34A]"
                  : "border-[#D97706]/20 text-[#D97706]"
              }`}
            >
              {data.source}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {relativeTime(data.synced_at)}
            </span>
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-black/[0.06] px-4 py-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          ) : data && data.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    {Object.keys(data.data[0]).map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left font-medium text-muted-foreground"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.slice(0, 20).map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-black/[0.04] last:border-0"
                    >
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-1.5 text-foreground truncate max-w-[200px]">
                          {val === null ? (
                            <span className="text-muted-foreground italic">null</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.data.length > 20 && (
                <p className="mt-2 text-xs text-muted-foreground text-center">
                  Showing 20 of {data.record_count} records
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No config data available
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ConfigViewer({ systemId, modules }: ConfigViewerProps) {
  if (modules.length === 0) {
    return (
      <Card className="border-black/[0.08] bg-white/[0.70]">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Database className="h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">
            Select a system to view its configuration data
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {modules.map((mod) => (
        <ConfigTableAccordion key={mod} systemId={systemId} module={mod} />
      ))}
    </div>
  );
}
