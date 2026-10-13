import Link from "next/link";
import { Button, EmptyState } from "@/design";

/** Unmatched URLs and signed-out paths: no shell, so the page frames itself on the canvas. */
export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--m-canvas)", padding: "var(--m-space-6)" }}
    >
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        title="There is nothing at this address"
        detail="The page may have moved, or the link is wrong. Check the address, or start from home."
        action={
          <div className="flex items-center gap-2">
            <Button render={<Link href="/home" />}>Go home</Button>
            <Button variant="secondary" render={<Link href="/search" />}>Search</Button>
          </div>
        }
      />
    </main>
  );
}
