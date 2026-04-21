/**
 * MDS Status Components — vx-status-* CSS classes
 * 
 * These are utility components that map to the MDS design system.
 * They provide consistent status indicators throughout the UI.
 * 
 * For WS7/WS8 from Meridian v3.0 spec §4.
 */

import { mdsClasses } from "./mds";

/**
 * Status dot indicator — small colored circle
 */
export function StatusDot({ status }: { status: "online" | "offline" | "pending" | "unknown" }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${mdsClasses.statusDot[status]}`}
      aria-label={status}
    />
  );
}

/**
 * Severity badge — colored pill for severity levels
 */
export type Severity = "critical" | "high" | "medium" | "low";

export function SeverityBadge({ severity }: { severity: Severity }) {
  const labels: Record<Severity, string> = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
  };
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${mdsClasses.severity[severity]}`}>
      {labels[severity]}
    </span>
  );
}

/**
 * Status badge — colored pill for status indicators
 */
export type StatusType = "success" | "warning" | "error" | "info";

export function StatusBadge({ status, label }: { status: StatusType; label?: string }) {
  const defaultLabels: Record<StatusType, string> = {
    success: "Active",
    warning: "Pending",
    error: "Failed",
    info: "Info",
  };
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${mdsClasses.badge[status]}`}>
      {label ?? defaultLabels[status]}
    </span>
  );
}

/**
 * DQS Score color — maps score to appropriate color
 */
export function DqsScoreColor({ score }: { score: number }) {
  let colorClass: string;
  let label: string;
  
  if (score >= 90) {
    colorClass = mdsClasses.dqsScore.excellent;
    label = "Excellent";
  } else if (score >= 75) {
    colorClass = mdsClasses.dqsScore.good;
    label = "Good";
  } else if (score >= 60) {
    colorClass = mdsClasses.dqsScore.fair;
    label = "Fair";
  } else {
    colorClass = mdsClasses.dqsScore.poor;
    label = "Poor";
  }
  
  return (
    <span className={`font-semibold ${colorClass}`}>
      {score.toFixed(1)} <span className="text-xs opacity-70">{label}</span>
    </span>
  );
}

/**
 * Migration readiness indicator
 */
export type ReadinessStatus = "go" | "conditional" | "no-go";

export function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  const config: Record<ReadinessStatus, { label: string; color: string }> = {
    go: { label: "GO", color: "bg-[#4BA87A]" },
    conditional: { label: "Conditional", color: "bg-[#EA580C]" },
    "no-go": { label: "NO-GO", color: "bg-[#EF4444]" },
  };
  
  const { label, color } = config[status];
  
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold text-white ${color}`}>
      {label}
    </span>
  );
}

/**
 * Module status card
 */
export function ModuleStatusCard({
  name,
  score,
  findings,
  status
}: {
  name: string;
  score: number;
  findings: number;
  status: ReadinessStatus;
}) {
  return (
    <div className={`vx-card vx-card-interactive p-5`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-[#1A1F36]">{name}</h3>
        <ReadinessBadge status={status} />
      </div>
      <div className="flex items-end gap-4">
        <div>
          <div className="text-xs text-[#6B7280] mb-1">DQS Score</div>
          <DqsScoreColor score={score} />
        </div>
        <div>
          <div className="text-xs text-[#6B7280] mb-1">Findings</div>
          <div className="text-lg font-semibold">{findings}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Progress bar with MDS styling
 */
export function ProgressBar({ 
  value, 
  max = 100,
  variant = "primary"
}: { 
  value: number; 
  max?: number;
  variant?: "primary" | "success" | "warning" | "error";
}) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  const colorMap = {
    primary: "bg-[#0D5639]",
    success: "bg-[#4BA87A]",
    warning: "bg-[#EA580C]",
    error: "bg-[#EF4444]",
  };
  
  return (
    <div className="w-full h-2 bg-[#F7F8FA] rounded-full overflow-hidden">
      <div 
        className={`h-full rounded-full transition-all duration-500 ${colorMap[variant]}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
