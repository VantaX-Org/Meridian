import Link from "next/link";
import { Button, EmptyState } from "@/design";

/** Rendered inside the shell when a page calls notFound() (a missing run, object or record). */
export default function AppNotFound() {
  return (
    <div style={{ padding: "var(--m-space-8) 0" }}>
      <EmptyState
        title="There is nothing at this address"
        detail="The page may have moved, or the item was removed. Check the link, or start from home."
        action={
          <div className="flex items-center gap-2">
            <Button render={<Link href="/home" />}>Go home</Button>
            <Button variant="secondary" render={<Link href="/search" />}>Search</Button>
          </div>
        }
      />
    </div>
  );
}
