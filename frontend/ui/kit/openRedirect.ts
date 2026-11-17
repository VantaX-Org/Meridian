/** Old `?open=kind:id` links whose sheet no longer exists, and the routed page that now shows that record. */
const LIST: Readonly<Record<string, string>> = {
  apikey: "/admin/apikeys",
  audit: "/admin/audit",
  channel: "/admin/notify",
  contract: "/people/contracts",
  contracts: "/people/contracts",
  delivery: "/admin/webhooks",
  digest: "/people/digests",
  field: "/mdm/catalogue",
  inbox: "/me/notifications",
  job: "/runs",
  mapping: "/admin/mappings",
  policypack: "/rules?view=packs",
  role: "/admin/roles",
  schedule: "/admin/schedules",
  syncschedule: "/admin/schedules",
  step: "/mdm/processes",
  survivorship: "/mdm/survivorship",
  triage: "/work/triage",
  user: "/admin/users",
  webhook: "/admin/webhooks",
  zobject: "/s",
  away: "/people",
  batch: "/approvals",
};
/** Kinds whose id names the record: [detail route prefix, list route when no id]. */
const DETAIL: Readonly<Record<string, readonly [string, string]>> = {
  request: ["/requests/", "/requests"],
  run: ["/run/", "/runs"],
  system: ["/s/", "/s"],
  connection: ["/s/", "/s"],
  certificate: ["/load/waves/", "/load/waves"],
  waves: ["/load/waves/", "/load/waves"],
};

/** The route (path and query) for an old open link, or null when no page shows that kind. `ask` is handled by the caller. */
export function openRoute(kind: string, id: string | undefined): string | null {
  const e = id ? encodeURIComponent(id) : "";
  if (kind === "config") return e ? `/s/${e}?tab=config` : "/s";
  const d = Object.prototype.hasOwnProperty.call(DETAIL, kind) ? DETAIL[kind] : null;
  if (d) return e ? d[0] + e : d[1];
  return Object.prototype.hasOwnProperty.call(LIST, kind) ? LIST[kind] : null;
}
