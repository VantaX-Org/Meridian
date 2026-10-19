import Link from "next/link";
import { Button } from "@/design";

/** Rendered inside the shell when a page calls notFound() (a missing run, object or record). One sheet, one action. */
export default function AppNotFound() {
  return (
    <div className="flex justify-center [padding:var(--m-space-8)_0]">
      <section data-state="empty" className="m-card flex w-full max-w-[560px] flex-col gap-2">
        <h2 className="m-text-h font-semibold m-ink">There is nothing at this address</h2>
        <p className="m-text-body m-ink-2">The page may have moved, or the item was removed. Check the link, or start from home.</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <Button render={<Link href="/home" />}>Go home</Button>
          <Link href="/search" className="m-text-body font-medium m-ink-accent-ink hover:underline">Search</Link>
        </div>
      </section>
    </div>
  );
}
