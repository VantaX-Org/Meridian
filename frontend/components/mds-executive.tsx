/**
 * MDS Executive & Admin Surface Components
 * 
 * Dashboard widgets, KPI cards, and admin management components
 * for executive, analyst, and admin user roles.
 * 
 * For WS10 from Meridian v3.0 spec §4.
 */

import { mdsClasses } from "@/lib/mds";

/**
 * KPI Card — key performance indicator for executive dashboard
 */
export function KpiCard({
  label,
  value,
  change,
  changeLabel,
  trend
}: {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  trend?: "up" | "down" | "stable";
}) {
  const changeColor = change && change > 0 
    ? "text-[#4BA87A]" 
    : change && change < 0 
      ? "text-[#EF4444]" 
      : "text-[#6B7280]";
  
  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  
  return (
    <div className="vx-card p-5">
      <div className="text-sm text-[#6B7280] mb-2">{label}</div>
      <div className="flex items-end justify-between">
        <div className="text-3xl font-bold text-[#1A1F36]">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-sm ${changeColor}`}>
            <span>{trendIcon}</span>
            <span>{Math.abs(change).toFixed(1)}%</span>
            {changeLabel && <span className="text-[#6B7280]">{changeLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tenant Health Card — shows health status of all connected systems
 */
export function TenantHealthCard({
  tenantName,
  systemsCount,
  healthySystems,
  lastSync,
  status
}: {
  tenantName: string;
  systemsCount: number;
  healthySystems: number;
  lastSync: string;
  status: "healthy" | "degraded" | "critical";
}) {
  const statusConfig = {
    healthy: { color: "bg-[#4BA87A]", label: "Healthy" },
    degraded: { color: "bg-[#EA580C]", label: "Degraded" },
    critical: { color: "bg-[#EF4444]", label: "Critical" },
  };
  
  const healthPercent = systemsCount > 0 ? (healthySystems / systemsCount) * 100 : 0;
  
  return (
    <div className="vx-card vx-card-interactive p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[#1A1F36]">{tenantName}</h3>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white/[0.70]`}>
          <span className={`w-2 h-2 rounded-full ${statusConfig[status].color}`} />
          {statusConfig[status].label}
        </span>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[#6B7280]">Connected Systems</span>
          <span className="font-medium text-[#1A1F36]">{healthySystems}/{systemsCount}</span>
        </div>
        
        <div className="h-2 w-full bg-[#F7F8FA] rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all ${
              healthPercent >= 80 ? "bg-[#4BA87A]" : 
              healthPercent >= 50 ? "bg-[#EA580C]" : "bg-[#EF4444]"
            }`}
            style={{ width: `${healthPercent}%` }}
          />
        </div>
        
        <div className="flex items-center justify-between text-xs text-[#6B7280]">
          <span>Last sync</span>
          <span>{lastSync}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Admin Metric Card — displays admin-level metrics
 */
export function AdminMetricCard({
  title,
  value,
  description,
  icon,
  trend
}: {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: { value: number; label: string };
}) {
  return (
    <div className="vx-card p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="text-sm text-[#6B7280] mb-1">{title}</div>
          <div className="text-2xl font-bold text-[#1A1F36]">
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
          {description && (
            <div className="text-xs text-[#6B7280] mt-1">{description}</div>
          )}
          {trend && (
            <div className={`text-xs mt-2 ${
              trend.value > 0 ? "text-[#4BA87A]" : 
              trend.value < 0 ? "text-[#EF4444]" : "text-[#6B7280]"
            }`}>
              {trend.value > 0 ? "↑" : trend.value < 0 ? "↓" : "→"} {Math.abs(trend.value)}% {trend.label}
            </div>
          )}
        </div>
        {icon && (
          <div className="vx-glass-pill p-2">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * System Health Indicator — small inline health status
 */
export function SystemHealthIndicator({
  name,
  status,
  lastCheck
}: {
  name: string;
  status: "online" | "offline" | "degraded";
  lastCheck?: string;
}) {
  const statusConfig = {
    online: { color: "bg-[#4BA87A]", label: "Online" },
    offline: { color: "bg-[#EF4444]", label: "Offline" },
    degraded: { color: "bg-[#EA580C]", label: "Degraded" },
  };
  
  return (
    <div className="flex items-center gap-2 py-1">
      <div className={`w-2 h-2 rounded-full ${statusConfig[status].color}`} />
      <span className="text-sm text-[#4A5568]">{name}</span>
      {lastCheck && (
        <span className="text-xs text-[#6B7280] ml-auto">{lastCheck}</span>
      )}
    </div>
  );
}

/**
 * Admin User Row — displays user in admin user management
 */
export function AdminUserRow({
  user,
  onEdit,
  onDelete
}: {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: "active" | "inactive";
    lastActive?: string;
  };
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <tr className="border-b border-[rgba(0,0,0,0.04)] hover:bg-[rgba(0,0,0,0.02)]">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[#0D5639]/10 flex items-center justify-center">
            <span className="text-sm font-medium text-[#0D5639]">
              {user.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <div className="text-sm font-medium text-[#1A1F36]">{user.name}</div>
            <div className="text-xs text-[#6B7280]">{user.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-[#0D5639]/10 text-[#0D5639] capitalize">
          {user.role.replace("_", " ")}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${
          user.status === "active" 
            ? "bg-[#4BA87A]/10 text-[#4BA87A]" 
            : "bg-[#6B7280]/10 text-[#6B7280]"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${user.status === "active" ? "bg-[#4BA87A]" : "bg-[#6B7280]"}`} />
          {user.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-[#6B7280]">
        {user.lastActive || "Never"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {onEdit && (
            <button 
              onClick={onEdit}
              className="text-xs text-[#0D5639] hover:text-[#0B4A31] transition-colors"
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button 
              onClick={onDelete}
              className="text-xs text-[#EF4444] hover:text-[#DC2626] transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Quick Stats Grid — grid of quick stats for dashboard
 */
export function QuickStatsGrid({
  stats
}: {
  stats: Array<{
    label: string;
    value: string | number;
    icon?: React.ReactNode;
    color?: string;
  }>
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {stats.map((stat, idx) => (
        <div key={idx} className="vx-card p-4 text-center">
          {stat.icon && (
            <div className={`mx-auto mb-2 p-2 rounded-lg w-fit ${
              stat.color ? stat.color : "bg-[#0D5639]/10"
            }`}>
              {stat.icon}
            </div>
          )}
          <div className="text-xl font-bold text-[#1A1F36]">
            {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
          </div>
          <div className="text-xs text-[#6B7280] mt-1">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
