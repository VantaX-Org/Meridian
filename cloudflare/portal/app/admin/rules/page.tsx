import { listRules, type Rule } from "@/lib/admin-api";

const SEVERITY_STYLE: Record<string, { bg: string; text: string }> = {
  critical: { bg: "rgba(220,38,38,0.15)",  text: "#f87171" },
  high:     { bg: "rgba(234,88,12,0.15)",  text: "#fb923c" },
  medium:   { bg: "rgba(217,119,6,0.15)",  text: "#fbbf24" },
  low:      { bg: "rgba(22,163,74,0.15)",  text: "#4ade80" },
  info:     { bg: "rgba(99,102,241,0.15)", text: "#a5b4fc" },
};

function Badge({ value, map }: { value: string; map: Record<string, { bg: string; text: string }> }) {
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

function relTime(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CATEGORIES = ["ecc", "successfactors", "warehouse"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  ecc: "ECC",
  successfactors: "SuccessFactors",
  warehouse: "Warehouse",
};

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const category = sp.category || "";
  const module = sp.module || "";
  const severity = sp.severity || "";
  const q = sp.q || "";

  let rules: Rule[] = [];
  let total = 0;
  let error = "";

  try {
    const result = await listRules({
      category: category || undefined,
      module: module || undefined,
      severity: severity || undefined,
      q: q || undefined,
    });
    rules = result.rules;
    total = result.total;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load rules";
  }

  // Group by category → module
  const grouped: Record<string, Record<string, Rule[]>> = {};
  for (const rule of rules) {
    if (!grouped[rule.category]) grouped[rule.category] = {};
    if (!grouped[rule.category][rule.module]) grouped[rule.category][rule.module] = [];
    grouped[rule.category][rule.module].push(rule);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Rules Engine</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {total} rule{total !== 1 ? "s" : ""} — master library
          </p>
        </div>
        <div className="flex gap-3">
          <a
            href="/admin/rules/new"
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            + Add Rule
          </a>
        </div>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search rules…"
          className="rounded-md px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        />
        <select
          name="category"
          defaultValue={category}
          className="rounded-md px-3 py-1.5 text-sm text-white outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <select
          name="severity"
          defaultValue={severity}
          className="rounded-md px-3 py-1.5 text-sm text-white outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <option value="">All severities</option>
          {["critical", "high", "medium", "low", "info"].map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--primary)" }}
        >
          Filter
        </button>
        {(category || severity || q) && (
          <a href="/admin/rules" className="text-sm" style={{ color: "var(--muted)" }}>
            Clear
          </a>
        )}
      </form>

      {error && (
        <div
          className="rounded-md p-4 text-sm"
          style={{ background: "rgba(220,38,38,0.1)", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {/* Grouped rules */}
      {rules.length === 0 && !error && (
        <div
          className="rounded-lg p-8 text-center"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No rules found.{" "}
            <a href="/admin/rules/new" style={{ color: "var(--primary)" }}>
              Add the first rule →
            </a>
          </p>
        </div>
      )}

      {CATEGORIES.filter((cat) => grouped[cat]).map((cat) => (
        <div key={cat} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            {CATEGORY_LABEL[cat]}
          </h2>
          {Object.entries(grouped[cat]).map(([mod, modRules]) => (
            <div
              key={mod}
              className="rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--border)" }}
            >
              <div
                className="px-4 py-2.5 flex items-center justify-between"
                style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border)" }}
              >
                <span className="text-sm font-medium text-white">
                  {mod.replace(/_/g, " ")}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {modRules.length} rule{modRules.length !== 1 ? "s" : ""}
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {modRules.map((rule) => (
                    <tr
                      key={rule.id}
                      className="transition-colors hover:bg-white/5"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <td className="px-4 py-3">
                        <a
                          href={`/admin/rules/${rule.id}`}
                          className="text-white font-medium hover:underline"
                        >
                          {rule.name}
                        </a>
                        {rule.description && (
                          <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: "var(--muted)" }}>
                            {rule.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge value={rule.severity} map={SEVERITY_STYLE} />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex h-2 w-2 rounded-full"
                          style={{ background: rule.enabled ? "#4ade80" : "#6b7280" }}
                          title={rule.enabled ? "Enabled" : "Disabled"}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--muted)" }}>
                        {relTime(rule.updated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={`/admin/rules/${rule.id}`}
                          className="text-xs"
                          style={{ color: "var(--primary)" }}
                        >
                          Edit →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
