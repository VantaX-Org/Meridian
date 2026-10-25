"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Mono, toast } from "@/design";
import { clientErrorId, reportClientError } from "@/lib/client-errors";

/** Renders inside the shell frame, so the index bar and scope bar stay usable when a page crashes. One sheet, one action. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  const reference = clientErrorId(error, error.digest);

  useEffect(() => {
    reportClientError(error, { digest: error.digest, pathname });
  }, [error, pathname]);

  const copyDetails = async () => {
    const details = JSON.stringify({ digest: reference, message: error.message, pathname, time: new Date().toISOString() }, null, 2);
    try {
      await navigator.clipboard.writeText(details);
      toast("Details copied");
    } catch {
      toast.error("Could not copy details");
    }
  };

  return (
    <div className="flex justify-center [padding:var(--m-space-8)_0]">
      <section
        // The hook e2e/visual.spec.ts finds an error sheet by, not copy.
        // eslint-disable-next-line aurora-writing/no-forbidden-copy
        data-state="error"
        role="alert"
        className="m-card flex w-full max-w-[560px] flex-col gap-2 [border-top:2px_solid_var(--m-critical)]"
      >
        <h2 className="m-text-h font-semibold m-ink">This page hit an error</h2>
        <p className="m-text-body m-ink-2">
          Reference <Mono inline>{reference}</Mono>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <Button onClick={() => reset()}>Try again</Button>
          <Link href="/home" className="m-text-body font-medium m-ink-accent-ink hover:underline">Go home</Link>
          <button type="button" onClick={copyDetails} className="m-text-body font-medium m-ink-accent-ink hover:underline">Copy details</button>
        </div>
      </section>
    </div>
  );
}
