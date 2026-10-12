import {
  Button, Card, IconButton, Pill, Badge, PageHeader, SeverityDot, Delta, Stat, ScoreRing, Skeleton, Mono,
} from "@/design";

import { ExportDemo } from "./export-demo";
import { GalleryMore } from "./gallery-more";

export const dynamic = "force-dynamic";

/** Storybook-free visual check (spec section 13). Static, no data, behind sign-in; served in production so the Aurora specs can cover it. */
export default function DesignGalleryPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader title="Design gallery" meta="Light and dark side by side" />
      <div className="grid gap-4 xl:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <div key={theme} data-theme={theme} className="rounded p-2" style={{ background: "var(--m-canvas)", color: "var(--m-ink)" }}>
        <Card title={theme === "light" ? "Light" : "Dark"}>
        <div className="flex flex-col gap-4">
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
          <div className="flex gap-4 items-center">
            <ExportDemo />
          </div>
          <GalleryMore />
        </div>
        </Card>
        </div>
      ))}
      </div>
    </div>
  );
}
