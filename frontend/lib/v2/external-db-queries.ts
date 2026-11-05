"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { listDbConnections, listDbTables } from "@/lib/api/v2/external-db";

const key = (f: boolean, ...rest: (string | null)[]) => ["v2", "external-db", f, ...rest] as const;

export const useDbConnections = (enabled = true) => {
  const f = useFixture();
  return useQuery({ queryKey: key(f, "connections"), queryFn: listDbConnections, staleTime: 15_000, enabled });
};

export const useDbTables = (id: string | null) => {
  const f = useFixture();
  return useQuery({ queryKey: key(f, "tables", id), queryFn: () => listDbTables(id as string), staleTime: 60_000, retry: false, enabled: Boolean(id) });
};

export const refreshDbConnections = (qc: QueryClient): Promise<void> => qc.invalidateQueries({ queryKey: ["v2", "external-db"] });
