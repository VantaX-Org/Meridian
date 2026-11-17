"use client";

import { formatModuleName } from "@/lib/format";
import { FieldChip } from "@/ui/kit";

/** An object code (module or object type) with its plain name beside it. */
export function ObjChip({ code }: { code: string }) {
  return <FieldChip code={code} description={formatModuleName(code)} />;
}
