import Link from "next/link";
import { Button } from "@/design";

/** Unmatched URLs and signed-out paths: no shell, so the sheet frames itself on the canvas. One sheet, one action. */
export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center [background:var(--m-canvas)] [padding:var(--m-space-6)]"
    >
      <h1 className="sr-only">Page not found</h1>
      <section data-state="empty" className="m-card flex w-full max-w-[560px] flex-col gap-2">
        <h2 className="m-text-h font-semibold m-ink">There is nothing at this address</h2>
        <p className="m-text-body m-ink-2">The page may have moved, or the link is wrong. Check the address, or start from home.</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <Button render={<Link href="/home" />}>Go home</Button>
          <Link href="/search" className="m-text-body font-medium m-ink-accent-ink hover:underline">Search</Link>
        </div>
      </section>
    </main>
  );
}
