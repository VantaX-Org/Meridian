import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "../primitives/IconButton";

/** With `pageSize` and `total` it reads "1–50 of 2,310"; without them it falls back to "Page 1 of 4". */
export function Pager({
  page, pageCount, onPageChange, pageSize, total,
}: { page: number; pageCount: number; onPageChange: (page: number) => void; pageSize?: number; total?: number }) {
  const label =
    pageSize !== undefined && total !== undefined
      ? `${total === 0 ? 0 : (page - 1) * pageSize + 1}\u2013${Math.min(page * pageSize, total)} of ${total.toLocaleString()}`
      : `Page ${page} of ${pageCount}`;
  return (
    <div className="flex items-center justify-end gap-2 m-text-meta m-numeric" style={{ color: "var(--m-ink-3)" }}>
      <span>{label}</span>
      <IconButton aria-label="Previous" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft size={16} />
      </IconButton>
      <IconButton aria-label="Next" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        <ChevronRight size={16} />
      </IconButton>
    </div>
  );
}
