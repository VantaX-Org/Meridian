// frontend/app/(app)/loading.tsx
import { Skeleton, StatSkeleton } from "@/design";

export default function AppLoading() {
  return (
    <div className="m-motion-stagger flex flex-col gap-4" aria-busy="true">
      <span role="status" className="sr-only">Loading the page</span>
      <Skeleton width={360} height={24} />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>
      <Skeleton height={320} />
    </div>
  );
}
