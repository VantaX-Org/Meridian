export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number }) {
  return (
    <span
      aria-hidden
      style={{ display: "inline-block", width, height, background: "var(--m-line)", borderRadius: "var(--m-radius-control)" }}
    />
  );
}
