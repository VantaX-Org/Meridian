import { listTenants, type Tenant } from "@/lib/admin-api";

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  active:    { bg: "rgba(22,163,74,0.15)",  text: "#4ade80" },
  trial:     { bg: "rgba(8,145,178,0.15)",  text: "#67e8f9" },
  suspended: { bg: "rgba(220,38,38,0.15)",  text: "#f87171" },
  expired:   { bg: "rgba(107,114,128,0.15)", text: "#9ca3af" },
};

const TIER_STYLE: Record<string, { bg: string; text: string }> = {
  starter:      { bg: "rgba(75,85,99,0.3)",   text: "#d1d5db" },
  professional: { bg: "rgba(15,110,86,0.3)",  text: "#4ade80" },
  enterprise:   { bg: "rgba(124,58,237,0.3)", text: "#c4b5fd" },
};

function Badge({
  value,
  map,
}: {
  value: string;
  map: Record<string, { bg: string; text: string }>;
}) {
  const style = map[value] || { bg: "rgba(75,85,99,0.3)", text: "#d1d5db" };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium capitalize"
      style={{ background: style.bg, color: style.text }}
    >
      {value}
    </span>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(d: string) {
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const status = sp.status || "";
  const tier = sp.tier || "";
  const q = sp.q || "";

  let tenants: Tenant[] = [];
  let error = "";
  try {
    const result = await listTenants({
      status: status || undefined,
      tier: tier || undefined,
      q: q || undefined,
    });
    tenants = result.tenants;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load tenants";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tenants</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
            {status && ` · ${status}`}
            {tier && ` · ${tier}`}
          </p>
        </div>
        <a
          href="/admin/tenants/new"
          className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--primary)" }}
        >
          + Add Tenant
        </a>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search company or email…"
          className="rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-md px-3 py-1.5 text-sm text-white outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="expired">Expired</option>
        </select>
        <select
          name="tier"
          defaultValue={tier}
          className="rounded-md px-3 py-1.5 text-sm text-white outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">All tiers</option>
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <button
          type="submit"
          className="rounded-md px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--primary)" }}
        >
          Filter
        </button>
        {(status || tier || q) && (
          <a href="/admin/tenants" className="text-sm" style={{ color: "var(--muted)" }}>
            Clear
          </a>
        )}
      </form>

      {error && (
        <div className="rounded-md p-4 text-sm" style={{ background: "rgba(220,38,38,0.1)", color: "#f87171" }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div
        className="overflow-x-auto rounded-lg"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Company", "Tier", "Status", "Expiry", "Created", ""].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide"
                    style={{ color: "var(--muted)" }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                  No tenants found
                </td>
              </tr>
            )}
            {tenants.map((t) => {
              const days = daysUntil(t.expiry_date);
              return (
                <tr
                  key={t.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                  className="transition-colors hover:bg-white/5"
                >
                  <td className="px-4 py-3">
                    <a href={`/admin/tenants/${t.id}`} className="text-white font-medium hover:underline">
                      {t.company_name}
                    </a>
                    <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {t.contact_email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={t.tier} map={TIER_STYLE} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={t.status} map={STATUS_STYLE} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-white">{formatDate(t.expiry_date)}</span>
                    {days > 0 && days <= 30 && (
                      <p className="text-xs mt-0.5" style={{ color: "#f59e0b" }}>
                        {days}d remaining
                      </p>
                    )}
                    {days <= 0 && (
                      <p className="text-xs mt-0.5" style={{ color: "#ef4444" }}>
                        Expired
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                    {formatDate(t.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/admin/tenants/${t.id}`}
                      className="text-xs font-medium transition-colors"
                      style={{ color: "var(--primary)" }}
                    >
                      Manage →
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
