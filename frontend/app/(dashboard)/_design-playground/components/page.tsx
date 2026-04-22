"use client";

/**
 * Aurora component gallery — WS2.
 *
 * Renders every foundational primitive exported from `@/components/aurora`
 * so designers and reviewers can sight-check variants, sizes, tones, and
 * keyboard affordances in one scroll.
 *
 * Paired with `/_design-playground/aurora` (tokens). Both pages retire at
 * WS8 cutover in favour of Storybook (stood up in WS2 follow-up).
 */

import { useState } from "react";
import {
  Avatar,
  Banner,
  Button,
  Chip,
  Combobox,
  Divider,
  Field,
  Icon,
  Input,
  Select,
  type SelectOption,
  Stack,
  Text,
  Textarea,
} from "@/components/aurora";
import { auroraSapIcons } from "@/lib/aurora";

const systemOptions: SelectOption[] = [
  { value: "ecc-prd", label: "ECC PRD — Global production" },
  { value: "s4-dev", label: "S/4HANA DEV — Migration sandbox" },
  { value: "s4-qas", label: "S/4HANA QAS — UAT" },
  { value: "sf-prd", label: "SuccessFactors PRD" },
  { value: "concur-prd", label: "Concur — Travel + Expense" },
  { value: "ariba-prd", label: "Ariba — P2P" },
];

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
        padding: "var(--aurora-space-8) var(--aurora-space-6)",
        borderBottom: "1px solid var(--aurora-canvas-line)",
      }}
    >
      <Stack direction="column" gap={1} style={{ marginBottom: 24 }}>
        <Text variant="display-sm">{title}</Text>
        <Text variant="text-micro" tone="tertiary">
          {spec}
        </Text>
      </Stack>
      <Stack direction="column" gap={4}>
        {children}
      </Stack>
    </section>
  );
}

export default function AuroraComponentGalleryPage() {
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState<string>("s4-dev");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [active, setActive] = useState<string[]>(["business_partner"]);

  function toggle(value: string) {
    setActive((current) =>
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
  }

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
          padding:
            "var(--aurora-space-12) var(--aurora-space-6) var(--aurora-space-6)",
        }}
      >
        <Text variant="text-micro" tone="muted">
          Aurora — WS2 component gallery
        </Text>
        <Text variant="display-lg" as="h1" style={{ maxWidth: 900 }}>
          Primitives first. Surfaces next.
        </Text>
        <Text
          variant="text-lead"
          tone="secondary"
          style={{ maxWidth: 720, marginTop: 12 }}
        >
          Twelve foundational primitives built from the Aurora token system —
          Text, Icon, Stack, Divider, Button, Input, Textarea, Select,
          Combobox, Chip, Avatar, Banner. Every variant on this page compiles
          from <code>@/components/aurora</code>.
        </Text>
      </header>

      <Section title="Typography" spec="§5.3 — six sizes wrapped in <Text>">
        <Stack direction="column" gap={3}>
          <Text variant="display-lg">The design system speaks first.</Text>
          <Text variant="display-sm">Dark-first canvas. One gradient.</Text>
          <Text variant="text-lead">
            Lead paragraphs surface the verdict in under 800 ms.
          </Text>
          <Text variant="text-body">
            Body copy tells the operator what happened, why it matters, and
            what to do next — never all three in the same sentence.
          </Text>
          <Text variant="text-small" tone="secondary">
            Small copy carries context: 2 hours ago · 54 affected records ·
            assigned to <Text as="span" numeric>R. Patel</Text>.
          </Text>
          <Text variant="text-micro">SECTION · TIMESTAMP · BREADCRUMB</Text>
          <Text variant="display-sm" numeric tone="accent">
            42,318.07
          </Text>
        </Stack>
      </Section>

      <Section title="Buttons" spec="§5.7 — primary / secondary / ghost / danger">
        <Stack direction="row" gap={3} wrap>
          <Button variant="primary">Open record</Button>
          <Button variant="secondary">View history</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Reject finding</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </Stack>
        <Stack direction="row" gap={3} align="center" wrap>
          <Button variant="primary" size="sm">
            Compact
          </Button>
          <Button variant="secondary" size="md">
            Default
          </Button>
          <Button variant="primary" size="lg">
            Comfortable
          </Button>
        </Stack>
        <Stack direction="row" gap={3} wrap>
          <Button
            variant="primary"
            leadingIcon={
              <Icon size="md">
                <auroraSapIcons.workflowNode />
              </Icon>
            }
          >
            Run playbook
          </Button>
          <Button
            variant="secondary"
            trailingIcon={
              <Icon size="md">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Icon>
            }
          >
            Open drawer
          </Button>
        </Stack>
      </Section>

      <Section title="Form controls" spec="§7 — Field + Input / Textarea / Select / Combobox">
        <Stack direction="row" gap={6} wrap>
          <div style={{ minWidth: 280, flex: 1 }}>
            <Field label="Record ID" helper="Exact match on BUT000.PARTNER">
              {({ controlId, helperId }) => (
                <Input
                  id={controlId}
                  aria-describedby={helperId}
                  placeholder="0000100012"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
            </Field>
          </div>
          <div style={{ minWidth: 280, flex: 1 }}>
            <Field
              label="Email"
              required
              error={
                query.length > 0 && !query.includes("@")
                  ? "Enter a valid email address"
                  : undefined
              }
            >
              {({ controlId, helperId }) => (
                <Input
                  id={controlId}
                  type="email"
                  placeholder="steward@company.com"
                  invalid={query.length > 0 && !query.includes("@")}
                  aria-describedby={helperId}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
            </Field>
          </div>
        </Stack>
        <Stack direction="row" gap={6} wrap>
          <div style={{ minWidth: 280, flex: 1 }}>
            <Field label="Source system" helper="Pick the system to target">
              {({ controlId, helperId }) => (
                <Select
                  id={controlId}
                  aria-describedby={helperId}
                  options={systemOptions}
                  value={system}
                  onValueChange={setSystem}
                  placeholder="Choose a system"
                />
              )}
            </Field>
          </div>
          <div style={{ minWidth: 280, flex: 1 }}>
            <Field
              label="Typeahead"
              helper="Arrow keys to navigate, Enter to commit, Esc to close"
            >
              {() => (
                <Combobox
                  options={systemOptions}
                  value={system}
                  onValueChange={setSystem}
                  placeholder="Search systems"
                />
              )}
            </Field>
          </div>
        </Stack>
        <Field label="Analyst notes" helper="Markdown supported in WS3.">
          {({ controlId, helperId }) => (
            <Textarea
              id={controlId}
              aria-describedby={helperId}
              placeholder="Add context for the next steward…"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
      </Section>

      <Section title="Chips" spec="§7 — filter bar + status tags">
        <Stack direction="row" gap={2} wrap>
          <Chip
            selected={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All findings
          </Chip>
          <Chip
            selected={filter === "blocking"}
            onClick={() => setFilter("blocking")}
          >
            Blocking
          </Chip>
          <Chip
            selected={filter === "degrading"}
            onClick={() => setFilter("degrading")}
          >
            Degrading
          </Chip>
          <Chip
            selected={filter === "reviewed"}
            onClick={() => setFilter("reviewed")}
          >
            Reviewed
          </Chip>
        </Stack>
        <Stack direction="row" gap={2} wrap>
          <Chip tone="success">DQS 93</Chip>
          <Chip tone="warning">Stewardship backlog rising</Chip>
          <Chip tone="danger">Critical — 12 records</Chip>
          <Chip tone="info">New verdict</Chip>
          <Chip onDismiss={() => setFilter("all")}>status: Open</Chip>
          <Chip
            leadingIcon={
              <Icon size="sm">
                <auroraSapIcons.materialMaster />
              </Icon>
            }
          >
            Material master
          </Chip>
        </Stack>
      </Section>

      <Section title="Icons" spec="§5.8 — SAP domain icons in <Icon>">
        <Stack direction="row" gap={2} wrap>
          {(Object.keys(auroraSapIcons) as Array<keyof typeof auroraSapIcons>).map(
            (name) => {
              const IconComponent = auroraSapIcons[name];
              const selected = active.includes(name);
              return (
                <Chip
                  key={name}
                  selected={selected}
                  onClick={() => toggle(name)}
                  leadingIcon={
                    <Icon size="sm">
                      <IconComponent />
                    </Icon>
                  }
                >
                  {name}
                </Chip>
              );
            },
          )}
        </Stack>
      </Section>

      <Section title="Avatars" spec="§7 — three sizes, monogram fallback">
        <Stack direction="row" gap={3} align="center">
          <Avatar name="Reshigan Naidoo" size="sm" />
          <Avatar name="Reshigan Naidoo" size="md" />
          <Avatar name="Reshigan Naidoo" size="lg" />
          <Divider orientation="vertical" />
          <Avatar name="Amelia Park" size="md" />
          <Avatar name="Kiyoshi Tanaka" size="md" />
          <Avatar name="Priya Ramanathan" size="md" />
        </Stack>
      </Section>

      <Section title="Banners" spec="§7 — one per viewport, status-tone">
        <Banner
          tone="info"
          title="Verdict materialised"
          action={
            <Button variant="ghost" size="sm">
              Review
            </Button>
          }
        >
          Three-way match on payables is holding at 99.2 %. Two config
          recommendations in the inbox.
        </Banner>
        <Banner
          tone="warning"
          title="Stewardship backlog rising"
          action={
            <Button variant="secondary" size="sm">
              Open workbench
            </Button>
          }
        >
          72 records awaiting steward review — median age 3 h 12 m.
        </Banner>
        <Banner
          tone="danger"
          title="Critical findings on company code 1000"
          action={
            <Button variant="danger" size="sm">
              Escalate
            </Button>
          }
        >
          12 records failing company-code completeness; S/4 migration will
          block until resolved.
        </Banner>
        <Banner tone="success" title="Daily sync complete">
          All 29 modules extracted. Config snapshot is current.
        </Banner>
      </Section>

      <Section title="Stack" spec="§5.4 — spacing driven by Aurora tokens">
        <Stack direction="row" gap={4} wrap>
          {[1, 2, 3, 4, 6, 8, 12].map((gap) => (
            <Stack
              key={gap}
              direction="column"
              gap={1}
              style={{
                background: "var(--aurora-canvas-raised)",
                border: "1px solid var(--aurora-canvas-line)",
                borderRadius: 8,
                padding: 12,
                minWidth: 96,
              }}
            >
              <Text variant="text-micro" tone="muted">
                gap={gap}
              </Text>
              <Stack direction="row" gap={gap as 1 | 2 | 3 | 4 | 6 | 8 | 12}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    background: "var(--aurora-accent-500)",
                    borderRadius: 2,
                  }}
                />
                <span
                  style={{
                    width: 12,
                    height: 12,
                    background: "var(--aurora-accent-500)",
                    borderRadius: 2,
                  }}
                />
                <span
                  style={{
                    width: 12,
                    height: 12,
                    background: "var(--aurora-accent-500)",
                    borderRadius: 2,
                  }}
                />
              </Stack>
            </Stack>
          ))}
        </Stack>
      </Section>
    </div>
  );
}
