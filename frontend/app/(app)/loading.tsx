// frontend/app/(app)/loading.tsx
import { Skeleton } from "@/design";

export default function AppLoading() {
  return (
    <div className="flex flex-col gap-2 p-6" aria-busy>
      <Skeleton height={32} />
      <Skeleton height={120} />
      <Skeleton height={120} />
    </div>
  );
}
