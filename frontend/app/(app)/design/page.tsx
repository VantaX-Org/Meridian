import { notFound } from "next/navigation";
import {
  Button, IconButton, Pill, Badge, SeverityDot, Delta, Stat, ScoreRing, Skeleton, Mono,
} from "@/design";

export const dynamic = "force-dynamic";

/** Storybook-free visual check (spec section 13). Dev only — 404s in production. */
export default function DesignGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="flex flex-col gap-8 p-6">
      {(["light", "dark"] as const).map((theme) => (
        <section
          key={theme}
          data-theme={theme}
          className="flex flex-col gap-4 p-6 rounded border"
          style={{ background: "var(--m-canvas)", borderColor: "var(--m-line)" }}
        >
          <h2 style={{ color: "var(--m-ink)" }}>{theme}</h2>
          <div className="flex gap-2 items-center">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <IconButton aria-label="Example icon button">{"•"}</IconButton>
          </div>
          <div className="flex gap-2 items-center">
            <Pill tone="go">Go</Pill>
            <Pill tone="at-risk">At risk</Pill>
            <Pill tone="no-go">No-go</Pill>
            <Badge count={3} />
          </div>
          <div className="flex gap-4 items-center">
            <SeverityDot severity="critical" />
            <SeverityDot severity="high" />
            <SeverityDot severity="medium" />
            <SeverityDot severity="low" />
            <SeverityDot severity="pass" />
          </div>
          <div className="flex gap-4 items-center">
            <Delta value={5} />
            <Delta value={-5} />
            <Stat label="DQS" value={92} delta={<Delta value={2} />} />
            <ScoreRing score={78} />
          </div>
          <div className="flex gap-4 items-center">
            <Skeleton width={120} />
            <Mono>MATNR.PLANT</Mono>
          </div>
        </section>
      ))}
    </div>
  );
}
