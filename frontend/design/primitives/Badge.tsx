export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[11px] leading-none rounded-full"
      style={{ background: "var(--m-accent)", color: "var(--m-sheet)" }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
