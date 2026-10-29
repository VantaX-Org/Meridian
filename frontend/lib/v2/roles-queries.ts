"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as r from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";

/**
 * React Query hooks of the step 6c verbs. Keys start with ["v2", "roles", fixture] so fixture and live answers never
 * share a cache entry; `refreshRoles` invalidates one family after a write. A 404 (an endpoint another builder has not
 * shipped yet, or an older backend) is not retried: the caller shows a dash.
 */
export const rolesKeys = {
  root: (fx: boolean) => ["v2", "roles", fx] as const,
  comments: (fx: boolean, kind: string, id: string) => ["v2", "roles", fx, "comments", kind, id] as const,
  watch: (fx: boolean, kind: string, id: string) => ["v2", "roles", fx, "watch", kind, id] as const,
  mentions: (fx: boolean) => ["v2", "roles", fx, "mentions"] as const,
  subs: (fx: boolean) => ["v2", "roles", fx, "subs"] as const,
  activity: (fx: boolean, id: string) => ["v2", "roles", fx, "activity", id] as const,
  delegations: (fx: boolean) => ["v2", "roles", fx, "delegations"] as const,
  chain: (fx: boolean) => ["v2", "roles", fx, "chain"] as const,
  contracts: (fx: boolean) => ["v2", "roles", fx, "contracts"] as const,
  contract: (fx: boolean, id: string) => ["v2", "roles", fx, "contracts", id] as const,
  gates: (fx: boolean) => ["v2", "roles", fx, "gates"] as const,
  links: (fx: boolean, all: boolean) => ["v2", "roles", fx, "links", all] as const,
  template: (fx: boolean) => ["v2", "roles", fx, "template"] as const,
  gaps: (fx: boolean) => ["v2", "roles", fx, "gaps"] as const,
  related: (fx: boolean, module: string) => ["v2", "roles", fx, "related", module] as const,
};

const notFound = (err: unknown): boolean => (err as { response?: { status?: number }; status?: number } | null)?.response?.status === 404 || (err as { status?: number } | null)?.status === 404;
const retry = (count: number, err: Error): boolean => !notFound(err) && count < 1;

export function refreshRoles(qc: QueryClient, family?: string): Promise<void> {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "v2" && q.queryKey[1] === "roles" && (!family || q.queryKey[3] === family) });
}

export function useComments(kind: r.CommentKind, id: string) {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.comments(fx, kind, id), queryFn: () => r.getComments(kind, id), enabled: Boolean(id), retry });
}
export function useWatch(kind: r.WatchKind, id: string) {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.watch(fx, kind, id), queryFn: () => r.getWatch(kind, id), enabled: Boolean(id), retry });
}
export function useUnreadMentions() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.mentions(fx), queryFn: r.getUnreadMentions, staleTime: 30_000, retry });
}
export function useSubscriptions() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.subs(fx), queryFn: r.getSubscriptions, retry });
}
export function useActivity(userId: string, enabled = true) {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.activity(fx, userId), queryFn: () => r.getActivity(userId), enabled: enabled && Boolean(userId), retry });
}
export function useMyDelegations() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.delegations(fx), queryFn: r.getMyDelegations, staleTime: 60_000, retry });
}
export function useEscalationChain() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.chain(fx), queryFn: r.getEscalationChain, retry });
}
export function useContracts() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.contracts(fx), queryFn: r.listContracts, retry });
}
export function useContract(id: string) {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.contract(fx, id), queryFn: () => r.getContractDetail(id), enabled: Boolean(id), retry });
}
export function useWaveGates() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.gates(fx), queryFn: r.getWaveGates, staleTime: 60_000, retry });
}
export function useShareLinks(all: boolean) {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.links(fx, all), queryFn: () => r.listShareLinks(all), retry });
}
export function useTemplate() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.template(fx), queryFn: r.getTemplate, retry });
}
export function useTemplateGaps() {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.gaps(fx), queryFn: r.getTemplateGaps, retry });
}
export function useRelated(module: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: rolesKeys.related(fx, module ?? ""), queryFn: () => r.getRelated(module ?? ""), enabled: Boolean(module), staleTime: 120_000, retry });
}

export const useRolesClient = (): QueryClient => useQueryClient();
export { notFound };
