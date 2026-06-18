/**
 * Bespoke sidebar nav icons — ported verbatim from the Claude Design
 * handoff bundle (meridian/project/icons.jsx). 24×24, stroke 1.6, with
 * subtle filled accents per item rather than reusing a generic library.
 * `currentColor` everywhere so they inherit the active/hover orange.
 */
import type { SVGProps } from "react";

type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "ref">;

const baseStroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// Command Centre — segmented dashboard with one active tile
export function LayoutDashIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <rect x="3" y="3" width="8" height="10" rx="1.6" />
      <rect x="13" y="3" width="8" height="6" rx="1.6" fill="currentColor" stroke="none" />
      <rect x="13" y="11" width="8" height="10" rx="1.6" />
      <rect x="3" y="15" width="8" height="6" rx="1.6" />
    </svg>
  );
}

// Workbench — clipboard with tick + row
export function ClipboardIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <rect x="9" y="3" width="6" height="4" rx="1.2" fill="currentColor" stroke="none" />
      <path d="m8.5 13 2 2 4-4.5" />
      <path d="M8.5 18h7" />
    </svg>
  );
}

// Process / Workflow — flow nodes (bottom solid)
export function WorkflowIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <rect x="3" y="4" width="6" height="6" rx="1.4" />
      <rect x="15" y="4" width="6" height="6" rx="1.4" />
      <rect x="9" y="14" width="6" height="6" rx="1.4" fill="currentColor" stroke="none" />
      <path d="M6 10v1.5a2 2 0 0 0 2 2h1" />
      <path d="M18 10v1.5a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

// Admin / Settings — slider rows
export function SettingsIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2.3" fill="white" />
      <circle cx="15" cy="12" r="2.3" fill="white" />
      <circle cx="8" cy="18" r="2.3" fill="white" />
    </svg>
  );
}

// Overview — ascending bars + accent dot
export function BarChartIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <rect x="4" y="13" width="3.5" height="7" rx="0.8" fill="currentColor" stroke="none" opacity="0.45" />
      <rect x="10.25" y="9" width="3.5" height="11" rx="0.8" fill="currentColor" stroke="none" opacity="0.7" />
      <rect x="16.5" y="5" width="3.5" height="15" rx="0.8" fill="currentColor" stroke="none" />
      <circle cx="18.25" cy="3" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Import — cloud + downward arrow into a tray
export function UploadIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <path d="M7 11a5 5 0 0 1 9.5-2A4 4 0 0 1 17 17H7a3 3 0 0 1 0-6Z" fill="currentColor" stroke="none" opacity="0.18" />
      <path d="M7 11a5 5 0 0 1 9.5-2A4 4 0 0 1 17 17H7a3 3 0 0 1 0-6Z" />
      <path d="M12 14V8" />
      <path d="m9.5 10.5 2.5-2.5 2.5 2.5" />
      <path d="M4 21h16" />
    </svg>
  );
}

// Findings — magnifier with solid pupil
export function AlertIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <circle cx="10.5" cy="10.5" r="3" fill="currentColor" stroke="none" />
      <path d="m15.6 15.6 3.8 3.8" strokeWidth="2" />
    </svg>
  );
}

// Analytics — filled area chart + peak
export function AnalyticsIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <path d="M3 19V5" />
      <path d="M3 19h18" />
      <path d="M5 16 9 11l3 3 4-7 4 6" />
      <path d="M5 16 9 11l3 3 4-7 4 6V19H5z" fill="currentColor" stroke="none" opacity="0.16" />
      <circle cx="16" cy="7" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Mining / Sparkles
export function SparklesNavIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <path d="M12 4.5 13.4 9 18 10.4 13.4 11.8 12 16.3 10.6 11.8 6 10.4 10.6 9z" fill="currentColor" stroke="none" />
      <path d="M19 16v3" />
      <path d="M17.5 17.5h3" />
      <path d="M5 5v2" />
      <path d="M4 6h2" />
    </svg>
  );
}

// Run Sync — play in circle
export function PlayIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Reports — document with mini bars
export function FileTextIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" fill="currentColor" stroke="none" opacity="0.25" />
      <path d="M14 3v6h6" />
      <rect x="7.5" y="13" width="2" height="4" fill="currentColor" stroke="none" />
      <rect x="11" y="11" width="2" height="6" fill="currentColor" stroke="none" />
      <rect x="14.5" y="14" width="2" height="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Versions — branching commit graph
export function GitCompareIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M6 8.5v7" />
      <path d="M8.4 6h4.6a3 3 0 0 1 3 3v.6" />
    </svg>
  );
}

// Golden Records — database with star
export function DatabaseIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <ellipse cx="12" cy="5.2" rx="7.5" ry="2.7" fill="currentColor" stroke="none" opacity="0.2" />
      <ellipse cx="12" cy="5.2" rx="7.5" ry="2.7" />
      <path d="M4.5 5.2v6c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7v-6" />
      <path d="M4.5 11.2v6c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7v-6" />
      <path d="m12 13.5 0.9 2 2.1.3-1.5 1.5.4 2.1L12 18.4l-1.9 1-.4-2.1L8.2 15.8l2.1-.3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Glossary — open book
export function BookIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2z" />
      <path d="M4 5a2 2 0 0 0 2 2h11" fill="currentColor" stroke="none" opacity="0.18" />
      <path d="M8.5 7.5h6" />
      <path d="M8.5 11.5h6" />
      <path d="M8.5 15.5h4" />
    </svg>
  );
}

// Contracts — document with seal
export function ContractIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M7.5 13h5" />
      <circle cx="15.5" cy="16.5" r="3" fill="currentColor" stroke="none" />
      <path d="m14.2 16.5 1 1 1.8-2" stroke="white" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

// Systems — server rack
export function ServerIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="7" rx="1.6" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.6" />
      <circle cx="7.5" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M11.5 7.5h5" />
      <path d="M11.5 16.5h5" />
    </svg>
  );
}

// Connectivity — 5-node network
export function PlugIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <circle cx="6" cy="6" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="18" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M7.6 7.6 10.4 10.4" />
      <path d="m16.4 7.6-2.8 2.8" />
      <path d="m7.6 16.4 2.8-2.8" />
      <path d="m16.4 16.4-2.8-2.8" />
    </svg>
  );
}

// Sync Monitor — circular arrows with dot
export function RefreshIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseStroke} {...rest} aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14-4.5" />
      <path d="M4 13a8 8 0 0 0 14 4.5" />
      <path d="M20 4v4h-4" />
      <path d="M4 20v-4h4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
