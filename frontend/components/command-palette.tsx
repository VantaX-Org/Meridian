"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  Brain,
  BrainCircuit,
  ClipboardList,
  Coins,
  Database,
  FileText,
  GitCompareArrows,
  KeyRound,
  LayoutDashboard,
  Network,
  Play,
  Plug2,
  RefreshCw,
  Search,
  Server,
  Settings,
  Sparkles,
  Upload,
  Workflow,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

interface NavOption {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  keywords?: string;
  shortcut?: string;
}

const PAGES: ReadonlyArray<{ group: string; items: NavOption[] }> = [
  {
    group: "Analyse",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "overview home dqs", shortcut: "⌘1" },
      { href: "/findings", label: "Findings", icon: AlertTriangle, keywords: "issues critical severity" },
      { href: "/analytics", label: "Analytics", icon: BarChart3, keywords: "charts metrics" },
      { href: "/nlp", label: "Ask AI", icon: BrainCircuit, keywords: "chat nlp question" },
      { href: "/mining", label: "Mining", icon: Sparkles, keywords: "patterns clustering" },
      { href: "/run-sync", label: "Run Sync", icon: Play, keywords: "trigger sync module" },
      { href: "/upload", label: "Import", icon: Upload, keywords: "load data file" },
    ],
  },
  {
    group: "Govern",
    items: [
      { href: "/stewardship", label: "Stewardship", icon: ClipboardList, keywords: "workbench review queue" },
      { href: "/golden-records", label: "Golden Records", icon: Database, keywords: "master mdm" },
      { href: "/glossary", label: "Glossary", icon: FileText, keywords: "terms business" },
      { href: "/relationships", label: "Relationships", icon: Network, keywords: "lineage graph" },
      { href: "/ai/rules", label: "AI Rules", icon: BrainCircuit, keywords: "propose" },
    ],
  },
  {
    group: "Connect",
    items: [
      { href: "/systems", label: "Systems", icon: Server, keywords: "sap hana" },
      { href: "/connectivity", label: "Connectivity", icon: Plug2, keywords: "sources endpoints" },
      { href: "/sync", label: "Sync Monitor", icon: RefreshCw, keywords: "jobs runs schedule" },
      { href: "/config-impact", label: "Config Impact", icon: Workflow, keywords: "features sankey" },
    ],
  },
  {
    group: "Report",
    items: [
      { href: "/reports", label: "Reports", icon: FileText, keywords: "pdf analysis" },
      { href: "/versions", label: "Versions", icon: GitCompareArrows, keywords: "history snapshots" },
      { href: "/llm-savings", label: "LLM Savings", icon: Coins, keywords: "cost reduction" },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, keywords: "preferences config" },
      { href: "/settings/ai", label: "AI Settings", icon: Brain, keywords: "ollama model provider" },
      { href: "/settings/licence", label: "Licence", icon: KeyRound, keywords: "seats modules" },
    ],
  },
];

type QuickAction = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  run: (ctx: { router: ReturnType<typeof useRouter> }) => void;
};

const QUICK_ACTIONS: ReadonlyArray<QuickAction> = [
  {
    id: "saved-views",
    label: "Go to Findings with active filters",
    hint: "Opens /findings with the last saved view applied",
    icon: Bookmark,
    run: ({ router }) => router.push("/findings"),
  },
  {
    id: "search-global",
    label: "Global search",
    hint: "Find findings, systems, modules by id or label",
    icon: Search,
    run: ({ router }) => router.push("/nlp"),
  },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [router, onOpenChange],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed left-1/2 top-[15vh] z-[61] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-black/10 bg-white/95 shadow-[0_0_0_1px_rgba(255,255,255,0.6)_inset,0_24px_64px_rgba(16,24,40,0.18)] backdrop-blur-xl data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          aria-label="Command palette"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Jump to any page, action, or saved view.
          </DialogPrimitive.Description>
          <Command label="Command palette" loop className="bg-transparent">
            <CommandInput placeholder="Jump to… (try 'findings', 'sap systems', 'llm')" autoFocus />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              {PAGES.map((group, gi) => (
                <React.Fragment key={group.group}>
                  {gi > 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading={group.group}>
                    {group.items.map((item) => (
                      <CommandItem
                        key={item.href}
                        value={`${item.label} ${item.keywords ?? ""}`}
                        onSelect={() => go(item.href)}
                      >
                        <item.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.shortcut ? (
                          <CommandShortcut>{item.shortcut}</CommandShortcut>
                        ) : (
                          <CommandShortcut className="opacity-0">—</CommandShortcut>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </React.Fragment>
              ))}
              <CommandSeparator />
              <CommandGroup heading="Quick actions">
                {QUICK_ACTIONS.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={`${action.label} ${action.hint ?? ""}`}
                    onSelect={() => {
                      onOpenChange(false);
                      action.run({ router });
                    }}
                  >
                    <action.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate">{action.label}</span>
                    {action.hint ? (
                      <span className="ml-auto truncate text-[10px] text-muted-foreground">
                        {action.hint}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↑</kbd>
                  <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↵</kbd>
                  open
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">esc</kbd>
                  close
                </span>
              </div>
              <span className="font-mono text-[10px]">Meridian</span>
            </div>
          </Command>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Hook that wires a global ⌘K / Ctrl-K keydown listener and returns
 * open-state plumbing for the <CommandPalette />.
 */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
