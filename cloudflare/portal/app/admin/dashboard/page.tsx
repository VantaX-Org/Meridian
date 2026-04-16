import { getAnalytics } from "@/lib/admin-api";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg p-5 space-y-1"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="text-3xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  active: "#16a34a",
  trial: "#0891b2",
  suspended: "#dc2626",
  expired: "#6b7280",
};

const TIER_BADGE: Record<string, string> = {
  starter: "#4b5563",
  professional: "#0f6e56",
  enterprise: "#7c3aed",
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(d: string) {
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function relTime(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function AdminDashboardPage() {
  let analytics;
  try {
    analytics = await getAnalytics();
  } catch {
    return (
      <div className="rounded-lg p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Unable to load analytics. Check LICENCE_WORKER_URL and LICENCE_ADMIN_SECRET.
        </p>
      </div>
    );
  }

  const active = analytics.by_status.active || 0;
  const trial = analytics.by_status.trial || 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">HQ Dashboard</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Overview of all customer deployments
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Tenants" value={analytics.total} />
        <StatCard label="Active" value={active} sub={`${trial} on trial`} />
        <StatCard
          label="Expiring Soon"
          value={analytics.expiring_soon.length}
          sub="within 30 days"
        />
        <StatCard
          label="Enterprise"
          value={analytics.by_tier.enterprise || 0}
          sub={`${analytics.by_tier.professional || 0} professional`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tenants by status */}
        <div
          className="rounded-lg p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h2 className="mb-4 text-sm font-semibold text-white">By Status</h2>
          <div className="space-y-2">
            {Object.entries(analytics.by_status).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: STATUS_COLOR[status] || "#6b7280" }}
                  />
                  <span className="text-sm text-white capitalize">{status}</span>
                </div>
                <span className="text-sm font-semibold text-white">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tenants by tier */}
        <div
          className="rounded-lg p-5"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h2 className="mb-4 text-sm font-semibold text-white">By Tier</h2>
          <div className="space-y-2">
            {Object.entries(analytics.by_tier).map(([tier, count]) => (
              <div key={tier} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white capitalize"
                    style={{ background: TIER_BADGE[tier] || "#4b5563" }}
                  >
                    {tier}
                  </span>
                </div>
                <span className="text-sm font-semibold text-white">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Expiring soon */}
        {analytics.expiring_soon.length > 0 && (
          <div
            className="rounded-lg p-5"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <h2 className="mb-4 text-sm font-semibold text-white">Expiring Soon</h2>
            <div className="space-y-2">
              {analytics.expiring_soon.map((t) => {
                const days = daysUntil(t.expiry_date);
                return (
                  <a
                    key={t.id}
                    href={`/admin/tenants/${t.id}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-white/5"
                  >
                    <span className="text-sm text-white">{t.company_name}</span>
                    <span
                      className="text-xs font-medium"
                      style={{ color: days <= 7 ? "#ef4444" : "#f59e0b" }}
                    >
                      {days <= 0 ? "Expired" : `${days}d`}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent activity */}
        {analytics.recent_activity.length > 0 && (
          <div
            className="rounded-lg p-5"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <h2 className="mb-4 text-sm font-semibold text-white">Recent Activity</h2>
            <div className="space-y-2">
              {analytics.recent_activity.map((t) => (
                <a
                  key={t.id}
                  href={`/admin/tenants/${t.id}`}
                  className="flex items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-white/5"
                >
                  <span className="text-sm text-white">{t.company_name}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {relTime(t.last_ping)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3">
        <a
          href="/admin/tenants/new"
          className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--primary)" }}
        >
          + Add Tenant
        </a>
        <a
          href="/admin/tenants"
          className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
          style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          All Tenants
        </a>
        <a
          href="/admin/rules"
          className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
          style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          Rules Engine
        </a>
      </div>
    </div>
  );
}
