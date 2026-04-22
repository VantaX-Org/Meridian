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
      DEFAULT: "#0070F2",
      foreground: "#FFFFFF",
      hover: "#0057D2",
      light: "#256F3A",
      dim: "rgba(0,112,242,0.08)",
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
      success: "#256F3A",
      warning: "#E76500",
      error: "#BB0000",
      info: "#7858FF",
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
      1: "#0070F2", // primary green
      2: "#E76500", // orange
      3: "#256F3A", // teal green
      4: "#7858FF", // indigo
      5: "#BB0000", // red
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
    glow: "0 0 16px rgba(0,112,242,0.20), 0 0 0 1px rgba(0,112,242,0.12)",
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
    success: "bg-[#256F3A]/10 text-[#256F3A] border border-[#256F3A]/20",
    warning: "bg-[#E76500]/10 text-[#E76500] border border-[#E76500]/20",
    error: "bg-[#BB0000]/10 text-[#BB0000] border border-[#BB0000]/20",
    info: "bg-[#7858FF]/10 text-[#7858FF] border border-[#7858FF]/20",
  },
  
  // Status dots
  statusDot: {
    online: "bg-[#256F3A]",
    offline: "bg-[#BB0000]",
    pending: "bg-[#E76500]",
    unknown: "bg-[#6B7280]",
  },
  
  // Severity
  severity: {
    critical: "text-[#BB0000] bg-[#BB0000]/10",
    high: "text-[#E76500] bg-[#E76500]/10",
    medium: "text-[#7858FF] bg-[#7858FF]/10",
    low: "text-[#6B7280] bg-[#6B7280]/10",
  },
  
  // DQS Score colors
  dqsScore: {
    excellent: "text-[#256F3A]",
    good: "text-[#0070F2]",
    fair: "text-[#E76500]",
    poor: "text-[#BB0000]",
  },
} as const;

// ── Type Exports ────────────────────────────────────────────────────────────

export type MDSColors = typeof MDS.colors;
export type MDSFonts = typeof MDS.fonts;
export type MDSRadius = typeof MDS.radius;
export type MDSShadows = typeof MDS.shadows;

export default MDS;
