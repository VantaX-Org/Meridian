import { Suspense } from "react";
import { WorkspaceHub } from "@/components/shell/workspace-hub";

/** "/" is the Command Centre; a first visit per session sends each role to its own workspace. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkspaceHub id="command-centre" landing />
    </Suspense>
  );
}
