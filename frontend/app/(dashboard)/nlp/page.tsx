"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sendNlpQuery } from "@/lib/api/contracts";
import type { NlpResponse } from "@/types/api";
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

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: NlpResponse["sources"];
  data?: NlpResponse["data"];
  chart_type?: NlpResponse["chart_type"];
}

const SUGGESTED_QUESTIONS = [
  "What are my most critical findings this week?",
  "Which modules have the worst DQS trend?",
  "Show me all Business Partners with confidence below 80%",
  "What mandatory fields are missing for S/4HANA migration?",
  "Which business partners are also vendors?",
  "Which sync run had the lowest AI quality score this week?",
  "What match rules has the AI proposed for Business Partner domain?",
  "How many merge decisions are pending for Material domain?",
];

const CHART_COLOURS = [
  "#0D5639", "#4BA87A", "#1E7A52", "#EA580C", "#DC2626",
  "#6366F1", "#4A5568", "#7C3AED",
];

function NlpChart({
  chartType,
  data,
}: {
  chartType: "bar" | "line" | "pie";
  data: Record<string, unknown>[];
}) {
  if (!data || data.length === 0) return null;

  const keys = Object.keys(data[0]);
  const labelKey = keys[0];
  const valueKey = keys.find((k) => typeof data[0][k] === "number") ?? keys[1];

  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={labelKey}
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={(entry) => String(entry[labelKey as keyof typeof entry])}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey={labelKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey={valueKey}
            stroke="#0D5639"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <XAxis dataKey={labelKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey={valueKey} fill="#0D5639" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function NlpPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
          content:
            "Sorry, I couldn't process that question. Please try rephrasing it.",
        },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (question?: string) => {
    const q = question ?? input.trim();
    if (!q) return;

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: q },
    ]);
    setInput("");
    mutation.mutate(q);
  };

  return (
    <div className="flex h-[calc(100vh-100px)] flex-col">
      <h1 className="mb-4 text-2xl font-bold">Ask Meridian</h1>

      {/* Messages */}
      <ScrollArea className="flex-1 rounded-lg border border-black/[0.08] bg-white/[0.70] p-4">
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Sparkles className="mb-4 h-10 w-10 text-primary" />
              <h2 className="mb-2 text-lg font-semibold text-foreground">
                Ask anything about your data quality
              </h2>
              <p className="mb-6 max-w-md text-sm text-muted-foreground">
                Query golden records, glossary, relationships, sync history,
                findings, stewardship queue, and AI proposed rules using
                natural language.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSend(q)}
                    className="rounded-full border border-black/[0.08] bg-white/[0.60] px-3 py-1.5 text-xs text-[#6B7280] transition-colors hover:border-primary hover:text-primary"
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
                className={`max-w-[75%] rounded-xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-primary text-white"
                    : "border border-black/[0.08] bg-white/[0.60] text-foreground"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>

                {/* Source badges */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {msg.sources.length <= 5 ? (
                      msg.sources.map((s, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="bg-white/80 text-xs"
                        >
                          {s.type} {s.id.slice(0, 8)}
                        </Badge>
                      ))
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-white/80 text-xs"
                      >
                        Based on {msg.sources.length} {msg.sources[0].type}s
                      </Badge>
                    )}
                  </div>
                )}

                {/* Chart */}
                {msg.chart_type && msg.data && msg.data.length > 0 && (
                  <div className="mt-3 rounded-lg bg-white/[0.70] p-3">
                    <NlpChart chartType={msg.chart_type} data={msg.data} />
                  </div>
                )}

                {/* Data table */}
                {msg.data &&
                  msg.data.length > 0 &&
                  !msg.chart_type && (
                    <div className="mt-3 overflow-x-auto rounded-lg bg-white/[0.70]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-black/[0.08]">
                            {Object.keys(msg.data[0]).map((key) => (
                              <th
                                key={key}
                                className="px-2 py-1.5 text-left font-medium text-muted-foreground"
                              >
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {msg.data.slice(0, 10).map((row, i) => (
                            <tr
                              key={i}
                              className="border-b border-black/[0.08]/50"
                            >
                              {Object.values(row).map((val, j) => (
                                <td
                                  key={j}
                                  className="px-2 py-1.5 text-foreground"
                                >
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
              <div className="flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white/[0.60] px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask about your data quality..."
          className="flex-1 rounded-lg border border-black/[0.08] bg-white/[0.70] px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={mutation.isPending}
        />
        <TooltipProvider delay={0}>
          <UiTooltip>
            <TooltipTrigger
              render={
                <Button
                  onClick={() => handleSend()}
                  disabled={mutation.isPending || !input.trim()}
                  className="bg-primary hover:bg-primary/80"
                />
              }
            >
              <Send className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Send message</TooltipContent>
          </UiTooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

