/**
 * MDS Analysis Journey Components — reusable analysis interface components
 * 
 * These components provide consistent MDS-styled interfaces for analysis pages:
 * - Findings list with filtering and sorting
 * - DQS score cards
 * - Module selection grid
 * - Progress indicators
 * 
 * For WS9 from Meridian v3.0 spec §4.
 */

import { mdsClasses } from "@/lib/mds";

/**
 * DQS Score Card — displays a module's data quality score with trend
 */
export function DqsScoreCard({
  module,
  score,
  trend,
  findings,
  status
}: {
  module: string;
  score: number;
  trend?: "up" | "down" | "stable";
  findings: number;
  status: "go" | "conditional" | "no-go";
}) {
  const statusConfig = {
    go: { label: "GO", bg: "bg-[#256F3A]", text: "text-white" },
    conditional: { label: "Conditional", bg: "bg-[#E76500]", text: "text-white" },
    "no-go": { label: "NO-GO", bg: "bg-[#BB0000]", text: "text-white" },
  };
  
  const scoreColor = score >= 90 
    ? "text-[#256F3A]" 
    : score >= 75 
      ? "text-[#0070F2]" 
      : score >= 60 
        ? "text-[#E76500]" 
        : "text-[#BB0000]";
  
  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const trendColor = trend === "up" ? "text-[#256F3A]" : trend === "down" ? "text-[#BB0000]" : "text-[#6B7280]";
  
  return (
    <div className="vx-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-[#1A1F36]">{module}</h3>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${statusConfig[status].bg} ${statusConfig[status].text}`}>
          {statusConfig[status].label}
        </span>
      </div>
      
      <div className="flex items-end gap-4 mb-4">
        <div>
          <div className="text-xs text-[#6B7280] mb-1">DQS Score</div>
          <div className={`text-3xl font-bold ${scoreColor}`}>
            {score.toFixed(1)}
            {trend && (
              <span className={`ml-1 text-lg ${trendColor}`}>{trendIcon}</span>
            )}
          </div>
        </div>
        
        <div>
          <div className="text-xs text-[#6B7280] mb-1">Findings</div>
          <div className="text-2xl font-semibold text-[#1A1F36]">{findings}</div>
        </div>
      </div>
      
      {/* Mini progress bar */}
      <div className="h-1.5 w-full bg-[#F7F8FA] rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all ${scoreColor.replace("text-", "bg-")}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Findings Table Row — styled row for findings list
 */
export function FindingsTableRow({
  finding,
  onClick
}: {
  finding: {
    check_id: string;
    module: string;
    field: string;
    severity: string;
    pass_rate: number;
    affected_count: number;
    dimension: string;
  };
  onClick?: () => void;
}) {
  const severityColors: Record<string, string> = {
    critical: "bg-[#BB0000]",
    high: "bg-[#E76500]",
    medium: "bg-[#7858FF]",
    low: "bg-[#6B7280]",
  };
  
  const passRateColor = (rate: number) =>
    rate >= 95 
      ? "text-[#256F3A]" 
      : rate >= 80 
        ? "text-[#0070F2]" 
        : rate >= 60 
          ? "text-[#E76500]" 
          : "text-[#BB0000]";
  
  return (
    <tr 
      className="border-b border-[rgba(0,0,0,0.04)] hover:bg-[rgba(0,0,0,0.02)] cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${severityColors[finding.severity] || "bg-[#6B7280]"}`} />
          <span className="text-sm font-mono text-[#4A5568]">{finding.check_id}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-[#1A1F36]">{finding.field}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-sm ${passRateColor(finding.pass_rate)} font-medium`}>
          {finding.pass_rate.toFixed(1)}%
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-[#4A5568]">
          {finding.affected_count.toLocaleString()}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-[rgba(0,0,0,0.04)] text-[#6B7280] capitalize">
          {finding.dimension}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-[#6B7280]">{finding.module}</span>
      </td>
    </tr>
  );
}

/**
 * Module Selection Card — for selecting modules in analysis setup
 */
export function ModuleSelectionCard({
  module,
  selected,
  onToggle,
  status,
  score
}: {
  module: {
    id: string;
    name: string;
    description: string;
    check_count: number;
  };
  selected: boolean;
  onToggle: () => void;
  status?: "active" | "inactive";
  score?: number;
}) {
  return (
    <button
      onClick={onToggle}
      className={`vx-card vx-card-interactive p-5 text-left w-full ${
        selected ? "ring-2 ring-[#0070F2]" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3 className="font-semibold text-[#1A1F36]">{module.name}</h3>
          <p className="text-sm text-[#6B7280] mt-1">{module.description}</p>
        </div>
        <div className={`vx-glass-pill px-3 py-1 ${selected ? "bg-[#0070F2]/10 border-[#0070F2]/30" : ""}`}>
          {selected ? (
            <svg className="w-4 h-4 text-[#0070F2]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : (
            <span className="text-xs text-[#6B7280]">{module.check_count}</span>
          )}
        </div>
      </div>
      
      {status === "active" && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 bg-[#F7F8FA] rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${score && score >= 90 ? "bg-[#256F3A]" : score && score >= 75 ? "bg-[#0070F2]" : score && score >= 60 ? "bg-[#E76500]" : "bg-[#BB0000]"}`}
              style={{ width: `${score || 0}%` }}
            />
          </div>
          <span className="text-xs text-[#6B7280]">{score?.toFixed(0) || 0}%</span>
        </div>
      )}
    </button>
  );
}

/**
 * Analysis Progress Bar — shows analysis pipeline progress
 */
export function AnalysisProgressBar({
  stage,
  progress,
  details
}: {
  stage: "extracting" | "checking" | "analyzing" | "complete" | "failed";
  progress: number;
  details?: string;
}) {
  const stageConfig = {
    extracting: { label: "Extracting data", color: "bg-[#7858FF]" },
    checking: { label: "Running checks", color: "bg-[#0070F2]" },
    analyzing: { label: "AI Analysis", color: "bg-[#E76500]" },
    complete: { label: "Complete", color: "bg-[#256F3A]" },
    failed: { label: "Failed", color: "bg-[#BB0000]" },
  };
  
  return (
    <div className="vx-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${stageConfig[stage].color}`} />
          <span className="font-medium text-[#1A1F36]">{stageConfig[stage].label}</span>
        </div>
        <span className="text-sm text-[#6B7280]">{progress}%</span>
      </div>
      
      <div className="h-2.5 w-full bg-[#F7F8FA] rounded-full overflow-hidden mb-2">
        <div 
          className={`h-full rounded-full transition-all ${stageConfig[stage].color}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      
      {details && (
        <p className="text-xs text-[#6B7280]">{details}</p>
      )}
    </div>
  );
}

/**
 * Executive Summary Card — displays key metrics for executives
 */
export function ExecutiveSummaryCard({
  metrics
}: {
  metrics: {
    totalFindings: number;
    criticalFindings: number;
    avgDqsScore: number;
    modulesReviewed: number;
    readinessScore: number;
  }
}) {
  return (
    <div className="vx-card p-6">
      <h2 className="text-lg font-bold text-[#1A1F36] mb-4">Executive Summary</h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-3xl font-bold text-[#1A1F36]">{metrics.totalFindings}</div>
          <div className="text-xs text-[#6B7280] mt-1">Total Findings</div>
        </div>
        
        <div className="text-center">
          <div className="text-3xl font-bold text-[#BB0000]">{metrics.criticalFindings}</div>
          <div className="text-xs text-[#6B7280] mt-1">Critical</div>
        </div>
        
        <div className="text-center">
          <div className={`text-3xl font-bold ${
            metrics.avgDqsScore >= 90 ? "text-[#256F3A]" : 
            metrics.avgDqsScore >= 75 ? "text-[#0070F2]" : 
            metrics.avgDqsScore >= 60 ? "text-[#E76500]" : "text-[#BB0000]"
          }`}>
            {metrics.avgDqsScore.toFixed(1)}%
          </div>
          <div className="text-xs text-[#6B7280] mt-1">Avg DQS Score</div>
        </div>
        
        <div className="text-center">
          <div className="text-3xl font-bold text-[#1A1F36]">{metrics.modulesReviewed}</div>
          <div className="text-xs text-[#6B7280] mt-1">Modules Reviewed</div>
        </div>
      </div>
      
      <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-[#4A5568]">Readiness Score</span>
          <span className={`font-semibold ${
            metrics.readinessScore >= 90 ? "text-[#256F3A]" :
            metrics.readinessScore >= 70 ? "text-[#E76500]" : "text-[#BB0000]"
          }`}>
            {metrics.readinessScore}%
          </span>
        </div>
        <div className="h-2 w-full bg-[#F7F8FA] rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all ${
              metrics.readinessScore >= 90 ? "bg-[#256F3A]" :
              metrics.readinessScore >= 70 ? "bg-[#E76500]" : "bg-[#BB0000]"
            }`}
            style={{ width: `${metrics.readinessScore}%` }}
          />
        </div>
      </div>
    </div>
  );
}
