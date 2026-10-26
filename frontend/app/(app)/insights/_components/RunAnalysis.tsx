"use client";

// "Run analysis" from any insight page: pick a system, pick its objects, extract and analyse.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Select } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { queryKeys } from "@/lib/query-keys";
import { ScopePicker } from "@/app/(app)/systems/[systemId]/scope-picker";

const LINK = "m-ink-accent underline underline-offset-2";

/** No system yet: the next step this role may take (connect needs manage_systems, import needs upload), else whom to ask. */
function NoSystems({ can }: { can: (action: string) => boolean }) {
  const connect = can("manage_systems");
  const upload = can("upload");
  if (connect) {
    return (
      <p className="m-text-body m-ink-2">
        No SAP system is connected yet. <Link href="/systems?connect=1" className={LINK}>Connect a system</Link>
        {upload ? <>, or <Link href="/import" className={LINK}>import a file</Link> to start without one</> : null}.
      </p>
    );
  }
  if (upload) {
    return <p className="m-text-body m-ink-2">No SAP system is connected yet. <Link href="/import" className={LINK}>Import a file</Link> to start without one, or ask an administrator to connect a system.</p>;
  }
  return <p className="m-text-body m-ink-2">No SAP system is connected yet. Ask an administrator to connect one.</p>;
}

/** `variant`: secondary by default, on the homes and in the insight action bar, where the page's own next step (the
 * home's verdict action, the insight's "Do next") is the one primary button; primary only where starting a run is
 * the page's main step. */
export function RunAnalysis({ variant = "secondary" }: { variant?: "primary" | "secondary" } = {}) {
  const { can } = useRole();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [systemId, setSystemId] = useState("");
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: open });
  if (!can("trigger_sync")) return null;
  const list = systems.data ?? [];
  const chosen = systemId || list[0]?.id || "";
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>Run analysis</Button>
      <Drawer open={open} onOpenChange={setOpen} title="Run analysis" subtitle="Extract the objects you choose into a new run, then analyse them">
        <div className="flex flex-col gap-4">
          <Select label="System" value={chosen} onValueChange={setSystemId} placeholder="Choose a system" options={list.map((s) => ({ value: s.id, label: s.name }))} />
          {systems.isError ? <p role="alert" className="m-text-body">The systems did not load. <button type="button" className="m-ink-accent underline underline-offset-2" onClick={() => void systems.refetch()}>Retry</button></p> : null}
          {systems.isSuccess && list.length === 0 ? <NoSystems can={can} /> : null}
          {chosen ? <ScopePicker id={chosen} onDownloaded={() => { setOpen(false); router.push("/runs"); }} /> : null}
        </div>
      </Drawer>
    </>
  );
}
