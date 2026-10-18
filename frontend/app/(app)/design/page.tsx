import { Button, Card, IconButton, Pill, Status, Badge, PageHeader, SeverityDot, Delta, Stat, Skeleton, Mono, Score } from "@/design";

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
        <div key={theme} data-theme={theme} className="rounded p-2 [background:var(--m-canvas)] m-ink">
        <Card title={theme === "light" ? "Light" : "Dark"}>
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 items-center">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <IconButton aria-label="Example icon button">{"•"}</IconButton>
          </div>
          <div className="flex gap-2 items-center">
            <Status kind="verdict" value="go" />
            <Status kind="verdict" value="at-risk" />
            <Status kind="verdict" value="no-go" />
            <Badge count={3} />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Status kind="severity" value="critical" />
            <Status kind="severity" value="high" />
            <Status kind="severity" value="medium" />
            <Status kind="severity" value="low" />
            <Status kind="lifecycle" value="queued" />
            <Status kind="lifecycle" value="running" />
            <Status kind="lifecycle" value="done" />
            <Status kind="lifecycle" value="failed" />
            <Pill>Free label</Pill>
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
            <Stat label="Failing records" value={1204} delta={<Delta value={2} />} />
            <Score size="sm" value={78} />
            <Score value={78} cap={70} criticals={1} />
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
