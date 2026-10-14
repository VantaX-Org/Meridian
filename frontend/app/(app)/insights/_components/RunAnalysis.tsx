"use client";

// "Run analysis" from any insight page: pick a system, pick its objects, extract and analyse.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Select } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { queryKeys } from "@/lib/query-keys";
import { ScopePicker } from "@/app/(app)/systems/[systemId]/scope-picker";

export function RunAnalysis() {
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
      <Button onClick={() => setOpen(true)}>Run analysis</Button>
      <Drawer open={open} onOpenChange={setOpen} title="Run analysis" subtitle="Extract the objects you choose into a new run, then analyse them">
        <div className="flex flex-col gap-4">
          <Select label="System" value={chosen} onValueChange={setSystemId} placeholder="Choose a system" options={list.map((s) => ({ value: s.id, label: s.name }))} />
          {chosen ? <ScopePicker id={chosen} onDownloaded={() => { setOpen(false); router.push("/runs"); }} /> : null}
        </div>
      </Drawer>
    </>
  );
}
