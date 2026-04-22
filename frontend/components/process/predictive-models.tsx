/**
 * Process Enhancement & Predictive Models Components
 * 
 * Provides components for:
 * - Predictive DQS forecasting
 * - Trend analysis
 * - Process bottleneck detection
 * - Anomaly prediction
 * 
 * For WS15 from Meridian v3.0 spec §6.
 */

import { useState, useMemo } from "react";

/**
 * Predictive DQS Score Card — shows predicted future score
 */
export function PredictiveDqsCard({
  currentScore,
  predictions,
  horizon = "30d",
  onHorizonChange,
}: {
  currentScore: number;
  predictions: Array<{ date: string; score: number; confidence: number }>;
  horizon?: "7d" | "30d" | "90d";
  onHorizonChange?: (horizon: "7d" | "30d" | "90d") => void;
}) {
  const latestPrediction = predictions[predictions.length - 1];
  const trend = latestPrediction.score - currentScore;
  
  const trendColor = trend > 0 
    ? "text-[#256F3A]" 
    : trend < 0 
      ? "text-[#BB0000]" 
      : "text-[#6B7280]";
  
  const trendIcon = trend > 0 ? "↑" : trend < 0 ? "↓" : "→";
  
  return (
    <div className="vx-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[#1A1F36]">DQS Prediction</h3>
        <div className="flex items-center gap-1">
          {(["7d", "30d", "90d"] as const).map((h) => (
            <button
              key={h}
              onClick={() => onHorizonChange?.(h)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                horizon === h 
                  ? "bg-[#0070F2] text-white" 
                  : "bg-[rgba(0,0,0,0.04)] text-[#6B7280] hover:bg-[rgba(0,0,0,0.08)]"
              }`}
            >
              {h}
            </button>
          ))}
        </div>
      </div>
      
      <div className="flex items-end gap-4 mb-4">
        <div>
          <div className="text-xs text-[#6B7280] mb-1">Current Score</div>
          <div className="text-3xl font-bold text-[#1A1F36]">
            {currentScore.toFixed(1)}
          </div>
        </div>
        
        <div className={`flex items-center gap-1 ${trendColor}`}>
          <span className="text-2xl">{trendIcon}</span>
          <span className="text-lg font-bold">
            {Math.abs(trend).toFixed(1)}
          </span>
        </div>
        
        <div>
          <div className="text-xs text-[#6B7280] mb-1">Predicted ({horizon})</div>
          <div className={`text-3xl font-bold ${
            latestPrediction.score >= 90 ? "text-[#256F3A]" :
            latestPrediction.score >= 75 ? "text-[#0070F2]" :
            latestPrediction.score >= 60 ? "text-[#E76500]" :
            "text-[#BB0000]"
          }`}>
            {latestPrediction.score.toFixed(1)}
          </div>
        </div>
      </div>
      
      {/* Confidence indicator */}
      <div className="flex items-center gap-2">
        <div className="text-xs text-[#6B7280]">Confidence:</div>
        <div className="flex-1 h-1.5 bg-[#F7F8FA] rounded-full overflow-hidden">
          <div 
            className="h-full bg-[#0070F2] rounded-full"
            style={{ width: `${latestPrediction.confidence * 100}%` }}
          />
        </div>
        <div className="text-xs text-[#6B7280]">
          {(latestPrediction.confidence * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}

/**
 * Trend Sparkline — mini chart showing score trends
 */
export function TrendSparkline({
  data,
  width = 120,
  height = 32
}: {
  data: Array<{ date: string; value: number }>;
  width?: number;
  height?: number;
}) {
  const points = useMemo(() => {
    if (data.length < 2) return "";
    
    const minVal = Math.min(...data.map(d => d.value));
    const maxVal = Math.max(...data.map(d => d.value));
    const range = maxVal - minVal || 1;
    
    return data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((d.value - minVal) / range) * height;
      return `${x},${y}`;
    }).join(" ");
  }, [data, width, height]);
  
  const gradientId = `sparkline-gradient-${Math.random().toString(36).slice(2)}`;
  
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0070F2" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#0070F2" stopOpacity="0" />
        </linearGradient>
      </defs>
      
      {/* Area fill */}
      <polygon
        fill={`url(#${gradientId})`}
        points={`0,${height} ${points} ${width},${height}`}
      />
      
      {/* Line */}
      <polyline
        fill="none"
        stroke="#0070F2"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      
      {/* Current value dot */}
      {data.length > 0 && (
        <circle
          cx={width}
          cy={height - ((data[data.length - 1].value - Math.min(...data.map(d => d.value))) / (Math.max(...data.map(d => d.value)) - Math.min(...data.map(d => d.value)) || 1)) * height}
          r={3}
          fill="#0070F2"
        />
      )}
    </svg>
  );
}

/**
 * Bottleneck Analysis Card — highlights process bottlenecks
 */
export function BottleneckAnalysisCard({
  bottlenecks
}: {
  bottlenecks: Array<{
    id: string;
    name: string;
    type: "delay" | "error" | "resource" | "queue";
    severity: number; // 0-1
    avgDuration?: string;
    frequency?: number;
    recommendation?: string;
  }>;
}) {
  const getTypeIcon = (type: string) => {
    switch (type) {
      case "delay": return "⏱";
      case "error": return "⚠";
      case "resource": return "📊";
      case "queue": return "📋";
      default: return "•";
    }
  };
  
  const getSeverityColor = (severity: number) => {
    if (severity >= 0.7) return "border-[#BB0000] bg-[rgba(239,68,68,0.05)]";
    if (severity >= 0.4) return "border-[#E76500] bg-[rgba(234,88,12,0.05)]";
    return "border-[#6B7280] bg-[rgba(0,0,0,0.02)]";
  };
  
  return (
    <div className="vx-card p-5">
      <h3 className="font-semibold text-[#1A1F36] mb-4">Process Bottlenecks</h3>
      
      <div className="space-y-3">
        {bottlenecks.length === 0 ? (
          <div className="text-center py-8 text-[#6B7280]">
            <span className="text-2xl">✓</span>
            <p className="mt-2">No significant bottlenecks detected</p>
          </div>
        ) : (
          bottlenecks.map((b) => (
            <div
              key={b.id}
              className={`p-4 rounded-lg border ${getSeverityColor(b.severity)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-xl">{getTypeIcon(b.type)}</span>
                  <div>
                    <div className="font-medium text-[#1A1F36]">{b.name}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[#6B7280]">
                      {b.avgDuration && <span>Avg: {b.avgDuration}</span>}
                      {b.frequency && <span>Freq: {b.frequency}%</span>}
                    </div>
                  </div>
                </div>
                <div className="vx-glass-pill px-2 py-1 text-xs">
                  {(b.severity * 100).toFixed(0)}% impact
                </div>
              </div>
              
              {b.recommendation && (
                <div className="mt-3 pt-3 border-t border-[rgba(0,0,0,0.06)]">
                  <div className="text-xs text-[#6B7280] mb-1">Recommendation</div>
                  <div className="text-sm text-[#1A1F36]">{b.recommendation}</div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Anomaly Alert Card — displays detected anomalies
 */
export function AnomalyAlertCard({
  anomalies,
  onDismiss,
  onInvestigate
}: {
  anomalies: Array<{
    id: string;
    type: string;
    severity: "critical" | "high" | "medium" | "low";
    description: string;
    detectedAt: string;
    affectedRecords?: number;
  }>;
  onDismiss?: (id: string) => void;
  onInvestigate?: (id: string) => void;
}) {
  const severityConfig = {
    critical: { color: "border-[#BB0000]", bg: "bg-[#BB0000]", label: "Critical" },
    high: { color: "border-[#E76500]", bg: "bg-[#E76500]", label: "High" },
    medium: { color: "border-[#7858FF]", bg: "bg-[#7858FF]", label: "Medium" },
    low: { color: "border-[#6B7280]", bg: "bg-[#6B7280]", label: "Low" },
  };
  
  return (
    <div className="vx-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-[#1A1F36] flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E76500] opacity-75"></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${severityConfig.critical.bg}`}></span>
          </span>
          Anomaly Alerts
        </h3>
        <span className="vx-glass-pill px-2 py-1 text-xs">
          {anomalies.length} active
        </span>
      </div>
      
      <div className="space-y-3">
        {anomalies.map((a) => (
          <div
            key={a.id}
            className={`p-4 rounded-lg border-l-4 ${severityConfig[a.severity].color} bg-white/[0.50]`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs text-white ${severityConfig[a.severity].bg}`}>
                    {severityConfig[a.severity].label}
                  </span>
                  <span className="text-xs text-[#6B7280]">{a.type}</span>
                </div>
                <div className="text-sm text-[#1A1F36]">{a.description}</div>
                <div className="flex items-center gap-3 mt-2 text-xs text-[#6B7280]">
                  <span>{a.detectedAt}</span>
                  {a.affectedRecords && (
                    <span>{a.affectedRecords.toLocaleString()} records affected</span>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {onInvestigate && (
                  <button
                    onClick={() => onInvestigate(a.id)}
                    className="text-xs text-[#0070F2] hover:text-[#0057D2] transition-colors"
                  >
                    Investigate
                  </button>
                )}
                {onDismiss && (
                  <button
                    onClick={() => onDismiss(a.id)}
                    className="text-xs text-[#6B7280] hover:text-[#4A5568] transition-colors"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Forecast Chart — DQS forecast visualization
 */
export function ForecastChart({
  historical,
  predictions,
  confidenceInterval
}: {
  historical: Array<{ date: string; value: number }>;
  predictions: Array<{ date: string; value: number; lower: number; upper: number }>;
  confidenceInterval?: number;
}) {
  const allData = [...historical, ...predictions];
  
  if (allData.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-[#6B7280]">
        Insufficient data for forecast
      </div>
    );
  }
  
  const historicalValues = historical.map((d) => d.value);
  const predictionBoundValues = predictions.flatMap((d) => [d.value, d.lower, d.upper]);
  const minVal = Math.min(...historicalValues, ...predictionBoundValues);
  const maxVal = Math.max(...historicalValues, ...predictionBoundValues);
  const range = maxVal - minVal || 1;
  
  const width = 600;
  const height = 200;
  const padding = 20;
  
  const toX = (i: number) => padding + (i / (allData.length - 1)) * (width - padding * 2);
  const toY = (v: number) => height - padding - ((v - minVal) / range) * (height - padding * 2);
  
  // Historical line points
  const historicalPoints = historical.map((d, i) => `${toX(i)},${toY(d.value)}`).join(" ");
  
  // Prediction line points
  const predictionLine = predictions.map((d, i) => `${toX(historical.length + i)},${toY(d.value)}`).join(" ");
  
  // Confidence area
  const confidenceArea = predictions.map((d, i) => 
    `${toX(historical.length + i)},${toY(d.upper)}`
  ).concat(
    [...predictions].reverse().map((d, i) => 
      `${toX(historical.length + predictions.length - 1 - i)},${toY(d.lower)}`
    )
  ).join(" ");
  
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="forecast-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0070F2" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0070F2" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="confidence-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7858FF" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#7858FF" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1={padding}
          y1={toY(minVal + t * range)}
          x2={width - padding}
          y2={toY(minVal + t * range)}
          stroke="#E5E7EB"
          strokeDasharray="4,4"
        />
      ))}
      
      {/* Confidence interval */}
      {predictions.length > 0 && (
        <polygon
          fill="url(#confidence-gradient)"
          points={confidenceArea}
        />
      )}
      
      {/* Historical line */}
      <polyline
        fill="none"
        stroke="#0070F2"
        strokeWidth={2}
        points={historicalPoints}
      />
      
      {/* Prediction line */}
      {predictions.length > 0 && (
        <polyline
          fill="none"
          stroke="#7858FF"
          strokeWidth={2}
          strokeDasharray="6,4"
          points={predictionLine}
        />
      )}
      
      {/* Current point */}
      {historical.length > 0 && (
        <circle
          cx={toX(historical.length - 1)}
          cy={toY(historical[historical.length - 1].value)}
          r={4}
          fill="#0070F2"
        />
      )}
      
      {/* Labels */}
      <text x={padding} y={height - 5} fontSize={10} fill="#6B7280">Past</text>
      <text x={width - padding} y={height - 5} fontSize={10} fill="#6B7280" textAnchor="end">Forecast</text>
      
      {/* Legend */}
      <g transform={`translate(${width - 120}, 10)`}>
        <line x1={0} y1={6} x2={20} y2={6} stroke="#0070F2" strokeWidth={2} />
        <text x={25} y={10} fontSize={10} fill="#6B7280">Historical</text>
        <line x1={0} y1={22} x2={20} y2={22} stroke="#7858FF" strokeWidth={2} strokeDasharray="6,4" />
        <text x={25} y={26} fontSize={10} fill="#6B7280">Forecast</text>
      </g>
    </svg>
  );
}
