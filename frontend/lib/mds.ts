/**
 * Meridian Design System (MDS) v1.0 — Component Token Reference
 * 
 * This file exports all design tokens used in the Meridian frontend.
 * Based on the glassmorphism light theme from globals.css.
 * 
 * For WS7 from Meridian v3.0 spec §4.
 */

export const MDS = {
  // ── Colors ──────────────────────────────────────────────────────────────────
  
  colors: {
    // Primary — Meridian Forest Green
    primary: {
      DEFAULT: "#0D5639",
      foreground: "#FFFFFF",
      hover: "#0B4A31",
      light: "#4BA87A",
      dim: "rgba(13,86,57,0.08)",
    },
    
    // Backgrounds
    background: {
      DEFAULT: "#F7F8FA",
      card: "rgba(255,255,255,0.70)",
      cardHover: "rgba(255,255,255,0.85)",
      elevated: "rgba(255,255,255,0.88)",
    },
    
    // Text
    text: {
      primary: "#1A1F36",
      secondary: "#4A5568",
      tertiary: "#6B7280",
    },
    
    // Status
    status: {
      success: "#4BA87A",
      warning: "#EA580C",
      error: "#EF4444",
      info: "#6366F1",
    },
    
    // Borders
    border: {
      DEFAULT: "rgba(0,0,0,0.08)",
      hover: "rgba(0,0,0,0.14)",
    },
    
    // Glass
    glass: {
      bg: "rgba(255,255,255,0.70)",
      bgHover: "rgba(255,255,255,0.85)",
      bgElevated: "rgba(255,255,255,0.92)",
      border: "rgba(0,0,0,0.08)",
      borderHover: "rgba(0,0,0,0.14)",
      blur: "16px",
    },
    
    // Charts
    chart: {
      1: "#0D5639", // primary green
      2: "#FF8C42", // orange
      3: "#4BA87A", // teal green
      4: "#6366F1", // indigo
      5: "#EF4444", // red
    },
  },
  
  // ── Typography ─────────────────────────────────────────────────────────────
  
  fonts: {
    sans: {
      DEFAULT: "var(--font-sans)",
      display: "var(--font-display)",
      mono: "var(--font-mono)",
    },
    sizes: {
      xs: "0.75rem",    // 11px
      sm: "0.8125rem",  // 13px (base)
      md: "0.875rem",   // 14px
      lg: "1rem",       // 16px
      xl: "1.125rem",   // 18px
      "2xl": "1.25rem", // 20px
      "3xl": "1.5rem",  // 24px
      "4xl": "1.875rem",// 30px
    },
  },
  
  // ── Radius ────────────────────────────────────────────────────────────────────
  
  radius: {
    sm: "calc(var(--radius) * 0.6)",  // ~9px
    md: "calc(var(--radius) * 0.8)",  // ~12px
    DEFAULT: "1rem",                   // ~16px
    lg: "calc(var(--radius) * 1.4)",   // ~22px
    xl: "calc(var(--radius) * 1.8)",   // ~29px
    "2xl": "calc(var(--radius) * 2.2)", // ~35px
    "3xl": "calc(var(--radius) * 2.6)", // ~42px
    "4xl": "calc(var(--radius) * 3.0)", // ~48px
  },
  
  // ── Shadows ─────────────────────────────────────────────────────────────────
  
  shadows: {
    card: "0 0 0 1px rgba(255,255,255,0.50) inset, 0 4px 24px rgba(0,0,0,0.04)",
    cardHover: "0 0 0 1px rgba(255,255,255,0.60) inset, 0 8px 32px rgba(0,0,0,0.06)",
    elevated: "0 0 0 1px rgba(255,255,255,0.70) inset, 0 8px 32px rgba(0,0,0,0.06)",
    glow: "0 0 16px rgba(13,86,57,0.20), 0 0 0 1px rgba(13,86,57,0.12)",
  },
  
  // ── Transitions ───────────────────────────────────────────────────────────
  
  transitions: {
    DEFAULT: "0.2s ease",
    slow: "0.35s ease-out",
  },
  
  // ── Layout ────────────────────────────────────────────────────────────────
  
  layout: {
    sidebar: {
      width: "280px",
      collapsed: "64px",
    },
    content: {
      maxWidth: "1400px",
      padding: "24px",
    },
  },
} as const;

// ── Utility Classes ─────────────────────────────────────────────────────────

export const mdsClasses = {
  // Card variants
  card: "vx-card",
  cardInteractive: "vx-card vx-card-interactive",
  
  // Glass variants
  glass: "vx-glass",
  glassElevated: "vx-glass-elevated",
  glassPill: "vx-glass-pill",
  
  // Background
  meshBg: "vx-mesh-bg",
  
  // Effects
  glow: "vx-glow",
  shimmer: "vx-glass-shimmer",
  
  // Status badges
  badge: {
    success: "bg-[#4BA87A]/10 text-[#4BA87A] border border-[#4BA87A]/20",
    warning: "bg-[#EA580C]/10 text-[#EA580C] border border-[#EA580C]/20",
    error: "bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20",
    info: "bg-[#6366F1]/10 text-[#6366F1] border border-[#6366F1]/20",
  },
  
  // Status dots
  statusDot: {
    online: "bg-[#4BA87A]",
    offline: "bg-[#EF4444]",
    pending: "bg-[#EA580C]",
    unknown: "bg-[#6B7280]",
  },
  
  // Severity
  severity: {
    critical: "text-[#EF4444] bg-[#EF4444]/10",
    high: "text-[#EA580C] bg-[#EA580C]/10",
    medium: "text-[#6366F1] bg-[#6366F1]/10",
    low: "text-[#6B7280] bg-[#6B7280]/10",
  },
  
  // DQS Score colors
  dqsScore: {
    excellent: "text-[#4BA87A]",
    good: "text-[#0D5639]",
    fair: "text-[#EA580C]",
    poor: "text-[#EF4444]",
  },
} as const;

// ── Type Exports ────────────────────────────────────────────────────────────

export type MDSColors = typeof MDS.colors;
export type MDSFonts = typeof MDS.fonts;
export type MDSRadius = typeof MDS.radius;
export type MDSShadows = typeof MDS.shadows;

export default MDS;
