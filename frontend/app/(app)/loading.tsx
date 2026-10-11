// frontend/app/(app)/loading.tsx
import { Skeleton } from "@/design";

export default function AppLoading() {
  return (
    <div className="m-motion-stagger flex flex-col gap-4 p-6" aria-busy>
      <Skeleton width={360} height={24} />
      <div className="grid gap-3" style={{ maxWidth: "var(--m-page-max)", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Skeleton height={96} />
        <Skeleton height={96} />
        <Skeleton height={96} />
      </div>
      <Skeleton height={320} />
    </div>
  );
}
