import { Suspense } from "react";
import { WorkspaceHub } from "@/components/shell/workspace-hub";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkspaceHub id="analyse" />
    </Suspense>
  );
}
