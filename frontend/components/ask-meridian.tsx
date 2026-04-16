"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  X,
  Send,
  Sparkles,
  Loader2,
  MessageCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { sendNlpQuery } from "@/lib/api/contracts";
import { useLicence } from "@/hooks/use-licence";
import type { NlpResponse } from "@/types/api";

/* ─── Types ─── */
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: NlpResponse["sources"];
  data?: NlpResponse["data"];
  chart_type?: NlpResponse["chart_type"];
}

const CHART_COLOURS = [
  "#0D5639", "#4BA87A", "#1E7A52", "#EA580C", "#DC2626",
  "#6366F1", "#4A5568", "#7C3AED",
];

const SUGGESTED_QUESTIONS = [
  "What are my most critical findings this week?",
  "Which modules have the worst DQS trend?",
  "What mandatory fields are missing for S/4HANA migration?",
  "How many merge decisions are pending for Material domain?",
];

/* ─── Mini chart renderer ─── */
function NlpChart({ chartType, data }: { chartType: "bar" | "line" | "pie"; data: Record<string, unknown>[] }) {
  if (!data || data.length === 0) return null;
  const keys = Object.keys(data[0]);
  const labelKey = keys[0];
  const valueKey = keys.find((k) => typeof data[0][k] === "number") ?? keys[1];

  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={labelKey} cx="50%" cy="50%" outerRadius={65} label={(e) => String(e[labelKey as keyof typeof e])}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <XAxis dataKey={labelKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Line type="monotone" dataKey={valueKey} stroke="#0D5639" strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data}>
        <XAxis dataKey={labelKey} tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Bar dataKey={valueKey} fill="#0D5639" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Main component ─── */
export function AskMeridian() {
  const { isFeatureEnabled } = useLicence();
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to latest message
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Mark as opened (hides first-load pulse)
  const handleOpen = () => {
    setOpen(true);
    setHasOpened(true);
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const mutation = useMutation({
    mutationFn: sendNlpQuery,
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer,
          sources: data.sources,
          data: data.data,
          chart_type: data.chart_type,
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Sorry, I couldn't process that question. Please try rephrasing.",
        },
      ]);
    },
  });

  const handleSend = useCallback((question?: string) => {
    const q = question ?? input.trim();
    if (!q) return;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: q }]);
    setInput("");
    mutation.mutate(q);
  }, [input, mutation]);

  if (!isFeatureEnabled("ask_meridian")) return null;

  return (
    <>
      {/* ─── Floating Action Button ─── */}
      {!open && (
        <button
          type="button"
          onClick={handleOpen}
          aria-label="Ask Meridian AI Assistant"
          className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_20px_rgba(13,86,57,0.35)] transition-all duration-200 hover:scale-105 hover:shadow-[0_6px_28px_rgba(13,86,57,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            !hasOpened ? "animate-[vx-pulse-dot_2s_ease-in-out_3]" : ""
          }`}
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* ─── Backdrop ─── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] lg:bg-transparent lg:backdrop-blur-none"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ─── Side drawer ─── */}
      <div
        role="dialog"
        aria-label="Ask Meridian AI Assistant"
        aria-modal="true"
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-[rgba(255,255,255,0.96)] shadow-[-8px_0_32px_rgba(0,0,0,0.08)] backdrop-blur-2xl transition-transform duration-300 ease-out sm:w-[420px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ borderLeft: "1px solid rgba(0,0,0,0.08)" }}
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.07] px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-[0_0_12px_rgba(13,86,57,0.25)]">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="font-display text-[15px] font-semibold text-foreground">Ask Meridian</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close Ask Meridian"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0 px-4 py-3">
          <div className="space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sparkles className="mb-3 h-8 w-8 text-primary" />
                <h3 className="mb-1 text-base font-semibold text-foreground">
                  Ask anything about your data quality
                </h3>
                <p className="mb-5 max-w-[280px] text-xs text-muted-foreground">
                  Query findings, golden records, sync history, and more using natural language.
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      className="rounded-full border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2.5 ${
                    msg.role === "user"
                      ? "bg-primary text-white"
                      : "border border-black/[0.07] bg-white/[0.80] text-foreground"
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {msg.sources.length <= 4 ? (
                        msg.sources.map((s, i) => (
                          <Badge key={i} variant="outline" className="bg-white/80 text-[10px]">
                            {s.type} {s.id.slice(0, 8)}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="bg-white/80 text-[10px]">
                          {msg.sources.length} {msg.sources[0].type}s
                        </Badge>
                      )}
                    </div>
                  )}

                  {msg.chart_type && msg.data && msg.data.length > 0 && (
                    <div className="mt-2 rounded-lg bg-white/[0.70] p-2">
                      <NlpChart chartType={msg.chart_type} data={msg.data} />
                    </div>
                  )}

                  {msg.data && msg.data.length > 0 && !msg.chart_type && (
                    <div className="mt-2 overflow-x-auto rounded-lg bg-white/[0.70]">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-black/[0.07]">
                            {Object.keys(msg.data[0]).map((key) => (
                              <th key={key} className="px-2 py-1 text-left font-medium text-muted-foreground">
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {msg.data.slice(0, 8).map((row, i) => (
                            <tr key={i} className="border-b border-black/[0.05]">
                              {Object.values(row).map((val, j) => (
                                <td key={j} className="px-2 py-1 text-foreground">
                                  {String(val ?? "—")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {mutation.isPending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl border border-black/[0.07] bg-white/[0.80] px-3 py-2.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="shrink-0 border-t border-black/[0.07] p-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about your data quality…"
              className="flex-1 rounded-xl border border-black/[0.08] bg-white/[0.80] px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              disabled={mutation.isPending}
              aria-label="Message input"
            />
            <Button
              onClick={() => handleSend()}
              disabled={mutation.isPending || !input.trim()}
              size="sm"
              className="h-[38px] w-[38px] shrink-0 bg-primary hover:bg-primary/90 p-0"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
