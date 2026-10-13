import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A deliberately tiny markdown renderer for the in-app guide: headings, paragraphs, bullet and numbered
 * lists, fenced code, and inline code, bold and links. Anything else is shown as plain text. Only
 * relative links are rendered as links; nothing in the guide may point outside the product.
 *
 * Heading levels are shifted down one (`#` renders as h3) because the shell owns the page's h1 and
 * `PageHeader` renders the h2.
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      i++;
      continue;
    }
    const bullet = /^[-*]\s+/;
    const numbered = /^\d+\.\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, "").trim());
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3}\s|```|[-*]\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    const key = `i${n++}`;
    if (token.startsWith("`")) {
      out.push(<code key={key} className="m-mono m-mono-inline">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      out.push(<strong key={key} className="font-semibold" style={{ color: "var(--m-ink)" }}>{token.slice(2, -2)}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link?.[2] ?? "";
      out.push(href.startsWith("/") ? <Link key={key} href={href} style={{ color: "var(--m-accent)" }}>{label}</Link> : label);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 text-[13px] leading-[20px]" style={{ color: "var(--m-ink-2)" }}>
      {parseMarkdown(source).map((b, idx) => {
        switch (b.kind) {
          case "heading":
            return b.level === 1
              ? <h3 key={idx} className="m-text-title font-semibold" style={{ color: "var(--m-ink)" }}>{renderInline(b.text)}</h3>
              : <h4 key={idx} className="mt-3 text-[15px] leading-5 font-semibold" style={{ color: "var(--m-ink)" }}>{renderInline(b.text)}</h4>;
          case "paragraph":
            return <p key={idx}>{renderInline(b.text)}</p>;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={idx} className={`flex flex-col gap-1 pl-5 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
              </Tag>
            );
          }
          case "code":
            return <pre key={idx} className="m-mono overflow-auto p-3" style={{ background: "var(--m-sheet-raised)", borderRadius: "var(--m-radius-control)" }}>{b.text}</pre>;
        }
      })}
    </div>
  );
}
