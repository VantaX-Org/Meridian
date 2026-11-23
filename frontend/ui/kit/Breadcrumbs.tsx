import Link from "next/link";

export interface Crumb { label: string; href?: string }

/** Path to the current page. More than four items fold the middle into one ellipsis; a long last item truncates with a title. */
export function Breadcrumbs({ items, label, collapsedLabel }: { items: Crumb[]; label: string; collapsedLabel: string }) {
  if (items.length === 0) return null;
  const folded = items.length > 4;
  const shown: (Crumb | null)[] = folded ? [items[0], null, ...items.slice(-2)] : items;
  return (
    <nav aria-label={label} className="mx-crumbs">
      <ol>
        {shown.map((c, i) => {
          const last = i === shown.length - 1;
          if (!c) return <li key="fold" title={items.slice(1, -2).map((x) => x.label).join(" / ")}><span aria-label={collapsedLabel}>…</span></li>;
          return (
            <li key={`${i}-${c.label}`}>
              {last || !c.href ? <span aria-current={last ? "page" : undefined} title={last ? c.label : undefined} className={last ? "mx-crumb-last" : undefined}>{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
