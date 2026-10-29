export interface Untranslated {
  at: string;
  kind: "jsx text" | "literal" | "template";
  text: string;
}
export interface Extraction {
  keys: Map<string, string[]>;
  untranslated: Untranslated[];
  missing: { key: string; at: string }[];
  gaps: { lang: "de" | "ja"; key: string }[];
  catalogue: Map<string, string | null>;
}
export function extract(root?: string): Extraction;
export function readCatalogue(file: string): Map<string, string | null>;
export function writeCatalogues(rows: [string, string, string, string][], root?: string): void;
