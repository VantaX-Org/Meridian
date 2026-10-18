"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button, ErrorState, Mono } from "@/design";
import { clientErrorId, reportClientError } from "@/lib/client-errors";

/** Renders inside the shell frame, so the rail and top bar stay usable when a page crashes. */
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
    <div className="[padding:var(--m-space-8)_0]">
      <ErrorState
        title="This page hit an error"
        message=""
        detail={<>Reference <Mono inline>{reference}</Mono></>}
        actions={
          <>
            <Button onClick={() => reset()}>Try again</Button>
            <Button variant="secondary" render={<Link href="/home" />}>Go home</Button>
            <Button variant="ghost" onClick={copyDetails}>Copy details</Button>
          </>
        }
      />
    </div>
  );
}
