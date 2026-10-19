import { Skeleton } from "@/design";

export default function AdminRolesLoading() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <Skeleton height={32} />
      <Skeleton height={240} />
    </div>
  );
}
