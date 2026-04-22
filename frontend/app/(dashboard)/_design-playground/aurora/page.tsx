"use client";

/**
 * Aurora token reference surface.
 *
 * Not a product page — a visual-regression fixture for WS1. Renders every
 * token exported from `lib/aurora` so designers and reviewers can sight-check
 * colour, type, spacing, motion, elevation, and iconography in one scroll.
 *
 * Deleted at the WS8 cutover in favour of Storybook (WS2). Lives under the
 * dashboard group so it inherits auth; route: `/_design-playground/aurora`.
 */

import {
  accent,
  auroraSapIcons,
  canvas,
  duration,
  easing,
  elevation,
  ink,
  space,
  status,
  typography,
  verdictHalo,
  viz,
} from "@/lib/aurora";
import { density, type DensityTier } from "@/lib/aurora/density";

function Section({
  title,
  spec,
  children,
}: {
  title: string;
  spec: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: `${space["space-8"]}px ${space["space-6"]}px`,
        borderBottom: "1px solid var(--aurora-canvas-line)",
      }}
    >
      <div style={{ marginBottom: space["space-6"] }}>
        <h2
          style={{
            fontFamily: "var(--aurora-font-display)",
            fontSize: `${typography["display-sm"].size}px`,
            lineHeight: `${typography["display-sm"].lineHeight}px`,
            letterSpacing: typography["display-sm"].tracking,
            color: "var(--aurora-fg-primary)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: `${typography["text-micro"].size}px`,
            lineHeight: `${typography["text-micro"].lineHeight}px`,
            letterSpacing: typography["text-micro"].tracking,
            textTransform: "uppercase",
            color: "var(--aurora-fg-tertiary)",
            margin: `${space["space-1"]}px 0 0`,
          }}
        >
          {spec}
        </p>
      </div>
      {children}
    </section>
  );
}

function Swatch({
  label,
  value,
  foreground,
}: {
  label: string;
  value: string;
  foreground?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: space["space-1"],
      }}
    >
      <div
        style={{
          background: value,
          color: foreground ?? "var(--aurora-ink-900)",
          height: 56,
          borderRadius: 8,
          border: "1px solid var(--aurora-canvas-line)",
          display: "flex",
          alignItems: "end",
          padding: space["space-2"],
          fontFamily: "var(--aurora-font-mono)",
          fontSize: 11,
        }}
      >
        {value}
      </div>
      <span
        style={{
          fontFamily: "var(--aurora-font-ui)",
          fontSize: typography["text-small"].size,
          color: "var(--aurora-fg-secondary)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: space["space-3"],
      }}
    >
      {children}
    </div>
  );
}

export default function AuroraTokenReferencePage() {
  return (
    <div
      data-theme="dark"
      style={{
        background: "var(--aurora-canvas-base)",
        color: "var(--aurora-fg-primary)",
        fontFamily: "var(--aurora-font-ui)",
        minHeight: "100vh",
      }}
    >
      <header
        style={{
          padding: `${space["space-12"]}px ${space["space-6"]}px ${space["space-6"]}px`,
        }}
      >
        <p
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: typography["text-micro"].size,
            letterSpacing: typography["text-micro"].tracking,
            textTransform: "uppercase",
            color: "var(--aurora-fg-muted)",
            margin: 0,
          }}
        >
          Aurora — WS1 token reference
        </p>
        <h1
          style={{
            fontFamily: "var(--aurora-font-display)",
            fontSize: typography["display-lg"].size,
            lineHeight: `${typography["display-lg"].lineHeight}px`,
            letterSpacing: typography["display-lg"].tracking,
            fontWeight: 600,
            margin: `${space["space-3"]}px 0 0`,
            maxWidth: 900,
          }}
        >
          The design system speaks first. Every token lives here.
        </h1>
        <p
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: typography["text-lead"].size,
            lineHeight: `${typography["text-lead"].lineHeight}px`,
            color: "var(--aurora-fg-secondary)",
            margin: `${space["space-3"]}px 0 0`,
            maxWidth: 720,
          }}
        >
          Colour, typography, spacing, motion, elevation, and the twelve SAP
          icons. Built from <code>@/lib/aurora</code>. Dark-first. One gradient.
          Six type sizes. Three motion durations.
        </p>
      </header>

      <Section title="Ink" spec="§5.1.1 — twelve stops">
        <Grid>
          {Object.entries(ink).map(([stop, value]) => (
            <Swatch key={stop} label={`ink-${stop}`} value={value} />
          ))}
        </Grid>
      </Section>

      <Section title="Canvas" spec="§5.1.2 — dark default / light alternative">
        <h3
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: typography["text-small"].size,
            color: "var(--aurora-fg-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: `0 0 ${space["space-2"]}px`,
          }}
        >
          Dark canvas (default)
        </h3>
        <Grid>
          {Object.entries(canvas.dark).map(([role, value]) => (
            <Swatch
              key={`dark-${role}`}
              label={`dark.${role}`}
              value={value}
              foreground="var(--aurora-ink-50)"
            />
          ))}
        </Grid>
        <h3
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: typography["text-small"].size,
            color: "var(--aurora-fg-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: `${space["space-6"]}px 0 ${space["space-2"]}px`,
          }}
        >
          Light canvas (alternative)
        </h3>
        <Grid>
          {Object.entries(canvas.light).map(([role, value]) => (
            <Swatch
              key={`light-${role}`}
              label={`light.${role}`}
              value={value}
              foreground="var(--aurora-ink-900)"
            />
          ))}
        </Grid>
      </Section>

      <Section title="Accent" spec="§5.1.3 — SAP Fiori Horizon blue, deeper">
        <Grid>
          {Object.entries(accent).map(([stop, value]) => (
            <Swatch
              key={stop}
              label={`accent-${stop}`}
              value={value}
              foreground={
                Number(stop) >= 400 ? "var(--aurora-ink-0)" : "var(--aurora-ink-900)"
              }
            />
          ))}
        </Grid>
      </Section>

      <Section title="Semantic status" spec="§5.1.4 — status, not decoration">
        <Grid>
          {Object.entries(status).map(([name, spec]) => (
            <div
              key={name}
              style={{
                background: spec.bg,
                border: `1px solid ${spec.border}`,
                color: spec[500],
                borderRadius: 8,
                padding: space["space-3"],
                display: "flex",
                flexDirection: "column",
                gap: space["space-1"],
              }}
            >
              <span
                style={{
                  fontFamily: "var(--aurora-font-ui)",
                  fontWeight: 600,
                  fontSize: typography["text-small"].size,
                  textTransform: "capitalize",
                }}
              >
                {name}
              </span>
              <span
                style={{
                  fontFamily: "var(--aurora-font-mono)",
                  fontSize: 11,
                  color: "var(--aurora-fg-secondary)",
                }}
              >
                {spec[500]}
              </span>
            </div>
          ))}
        </Grid>
      </Section>

      <Section title="Viz — categorical" spec="§5.1.5 — ordinal, iterate in order">
        <Grid>
          {viz.categorical.map((hex, idx) => (
            <Swatch
              key={hex}
              label={`viz-${idx + 1}`}
              value={hex}
              foreground="var(--aurora-ink-900)"
            />
          ))}
        </Grid>
      </Section>

      <Section title="Viz — sequential + diverging" spec="§5.1.5">
        <h3
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: typography["text-small"].size,
            color: "var(--aurora-fg-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: `0 0 ${space["space-2"]}px`,
          }}
        >
          Sequential — blue
        </h3>
        <div style={{ display: "flex", height: 40, borderRadius: 8, overflow: "hidden" }}>
          {viz.sequential.blue.map((hex) => (
            <div key={hex} style={{ flex: 1, background: hex }} />
          ))}
        </div>
        <h3
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: typography["text-small"].size,
            color: "var(--aurora-fg-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: `${space["space-4"]}px 0 ${space["space-2"]}px`,
          }}
        >
          Sequential — amber
        </h3>
        <div style={{ display: "flex", height: 40, borderRadius: 8, overflow: "hidden" }}>
          {viz.sequential.amber.map((hex) => (
            <div key={hex} style={{ flex: 1, background: hex }} />
          ))}
        </div>
        <h3
          style={{
            fontFamily: "var(--aurora-font-ui)",
            fontSize: typography["text-small"].size,
            color: "var(--aurora-fg-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: `${space["space-4"]}px 0 ${space["space-2"]}px`,
          }}
        >
          Diverging — red / green
        </h3>
        <div style={{ display: "flex", height: 40, borderRadius: 8, overflow: "hidden" }}>
          {viz.diverging.redGreen.map((hex) => (
            <div key={hex} style={{ flex: 1, background: hex }} />
          ))}
        </div>
      </Section>

      <Section title="Verdict halo" spec="§5.2 — the only gradient in the product">
        <div
          style={{
            position: "relative",
            height: 220,
            borderRadius: 16,
            overflow: "hidden",
            background: "var(--aurora-canvas-raised)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: verdictHalo,
              opacity: 0.5,
            }}
          />
          <p
            style={{
              position: "relative",
              fontFamily: "var(--aurora-font-display)",
              fontSize: typography["display-lg"].size,
              lineHeight: `${typography["display-lg"].lineHeight}px`,
              letterSpacing: typography["display-lg"].tracking,
              fontWeight: 600,
              color: "var(--aurora-ink-50)",
              textAlign: "center",
              margin: 0,
              maxWidth: 720,
            }}
          >
            Three-way match on payables is holding.
          </p>
        </div>
      </Section>

      <Section title="Type scale" spec="§5.3.2 — six sizes, not seven">
        <div style={{ display: "flex", flexDirection: "column", gap: space["space-4"] }}>
          {Object.entries(typography).map(([token, spec]) => (
            <div
              key={token}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: space["space-4"],
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--aurora-font-mono)",
                  fontSize: 11,
                  color: "var(--aurora-fg-tertiary)",
                }}
              >
                {token}
                <br />
                {spec.size}/{spec.lineHeight} · {spec.tracking}
              </span>
              <span
                style={{
                  fontFamily: token.startsWith("display")
                    ? "var(--aurora-font-display)"
                    : "var(--aurora-font-ui)",
                  fontSize: spec.size,
                  lineHeight: `${spec.lineHeight}px`,
                  letterSpacing: spec.tracking,
                  fontWeight: token === "display-lg" ? 600 : 400,
                }}
              >
                The design system speaks first.
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Spacing" spec="§5.4 — four-pixel base grid">
        <div style={{ display: "flex", flexDirection: "column", gap: space["space-3"] }}>
          {Object.entries(space).map(([token, px]) => (
            <div
              key={token}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 80px 1fr",
                alignItems: "center",
                gap: space["space-4"],
              }}
            >
              <span
                style={{
                  fontFamily: "var(--aurora-font-mono)",
                  fontSize: 11,
                  color: "var(--aurora-fg-tertiary)",
                }}
              >
                {token}
              </span>
              <span
                style={{
                  fontFamily: "var(--aurora-font-ui)",
                  fontSize: typography["text-small"].size,
                  color: "var(--aurora-fg-secondary)",
                }}
              >
                {px}px
              </span>
              <div
                style={{
                  height: 8,
                  width: px,
                  background: "var(--aurora-accent-500)",
                  borderRadius: 2,
                }}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Density tiers" spec="§5.4.1 — compact / default / comfortable">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: space["space-3"],
          }}
        >
          {(Object.keys(density) as DensityTier[]).map((tier) => {
            const spec = density[tier];
            return (
              <div
                key={tier}
                style={{
                  background: "var(--aurora-canvas-raised)",
                  border: "1px solid var(--aurora-canvas-line)",
                  borderRadius: 12,
                  padding: spec.cardPadding,
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--aurora-font-ui)",
                    fontSize: typography["text-micro"].size,
                    letterSpacing: typography["text-micro"].tracking,
                    textTransform: "uppercase",
                    color: "var(--aurora-fg-muted)",
                    margin: 0,
                  }}
                >
                  {tier}
                </p>
                <p
                  style={{
                    fontFamily: "var(--aurora-font-display)",
                    fontSize: typography["display-sm"].size,
                    lineHeight: `${typography["display-sm"].lineHeight}px`,
                    letterSpacing: typography["display-sm"].tracking,
                    color: "var(--aurora-fg-primary)",
                    margin: `${space["space-1"]}px 0`,
                  }}
                >
                  {spec.rowHeight}px rows
                </p>
                <p
                  style={{
                    fontFamily: "var(--aurora-font-ui)",
                    fontSize: typography["text-small"].size,
                    color: "var(--aurora-fg-secondary)",
                    margin: 0,
                  }}
                >
                  {spec.cardPadding}px card padding · {spec.tableTypeSize}px table
                  type · {spec.description}
                </p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Motion" spec="§5.5 — three durations, three easings">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: space["space-3"],
          }}
        >
          {(Object.keys(duration) as Array<keyof typeof duration>).map((name) => (
            <div
              key={name}
              style={{
                background: "var(--aurora-canvas-raised)",
                border: "1px solid var(--aurora-canvas-line)",
                borderRadius: 12,
                padding: space["space-4"],
              }}
            >
              <p
                style={{
                  fontFamily: "var(--aurora-font-mono)",
                  fontSize: 11,
                  color: "var(--aurora-fg-tertiary)",
                  margin: 0,
                }}
              >
                duration.{name}
              </p>
              <p
                style={{
                  fontFamily: "var(--aurora-font-display)",
                  fontSize: typography["display-sm"].size,
                  lineHeight: `${typography["display-sm"].lineHeight}px`,
                  letterSpacing: typography["display-sm"].tracking,
                  color: "var(--aurora-fg-primary)",
                  margin: `${space["space-1"]}px 0 0`,
                }}
              >
                {duration[name]}ms
              </p>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: space["space-4"],
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: space["space-3"],
          }}
        >
          {(Object.keys(easing) as Array<keyof typeof easing>).map((name) => (
            <div
              key={name}
              style={{
                background: "var(--aurora-canvas-raised)",
                border: "1px solid var(--aurora-canvas-line)",
                borderRadius: 12,
                padding: space["space-4"],
              }}
            >
              <p
                style={{
                  fontFamily: "var(--aurora-font-mono)",
                  fontSize: 11,
                  color: "var(--aurora-fg-tertiary)",
                  margin: 0,
                }}
              >
                easing.{name}
              </p>
              <p
                style={{
                  fontFamily: "var(--aurora-font-mono)",
                  fontSize: typography["text-small"].size,
                  color: "var(--aurora-fg-primary)",
                  margin: `${space["space-1"]}px 0 0`,
                }}
              >
                {easing[name]}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Elevation" spec="§5.6 — dark brightens, light shadows">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: space["space-3"],
          }}
        >
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <div
              key={level}
              style={{
                background: `var(--aurora-elev-${level}-bg)`,
                boxShadow: `var(--aurora-elev-${level}-shadow)`,
                border: "1px solid var(--aurora-canvas-line)",
                borderRadius: 12,
                padding: space["space-4"],
                minHeight: 100,
              }}
            >
              <p
                style={{
                  fontFamily: "var(--aurora-font-mono)",
                  fontSize: 11,
                  color: "var(--aurora-fg-tertiary)",
                  margin: 0,
                }}
              >
                elevation.{level}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Iconography" spec="§5.8 + §10 — twelve SAP icons, 1.5px stroke">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: space["space-3"],
          }}
        >
          {(Object.keys(auroraSapIcons) as Array<keyof typeof auroraSapIcons>).map(
            (name) => {
              const Icon = auroraSapIcons[name];
              return (
                <div
                  key={name}
                  style={{
                    background: "var(--aurora-canvas-raised)",
                    border: "1px solid var(--aurora-canvas-line)",
                    borderRadius: 12,
                    padding: space["space-4"],
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: space["space-2"],
                    color: "var(--aurora-fg-primary)",
                  }}
                >
                  <Icon size="lg" />
                  <span
                    style={{
                      fontFamily: "var(--aurora-font-mono)",
                      fontSize: 11,
                      color: "var(--aurora-fg-tertiary)",
                    }}
                  >
                    {name}
                  </span>
                </div>
              );
            },
          )}
        </div>
      </Section>
    </div>
  );
}
