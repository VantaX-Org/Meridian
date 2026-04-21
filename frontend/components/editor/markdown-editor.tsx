/**
 * Meridian Writing System — Markdown editor with real-time preview
 * 
 * Provides a writing interface with:
 * - Markdown editing with toolbar
 * - Live preview
 * - Word count and reading time
 * - Auto-save to localStorage
 * - Lint rule integration for content validation
 * 
 * For WS12 from Meridian v3.0 spec §4.
 */

import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * Markdown Editor with toolbar and preview
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minHeight = 400,
  className,
  autoSave = true,
  onLintViolation
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  autoSave?: boolean;
  onLintViolation?: (violations: LintViolation[]) => void;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // Sync external value changes
  useEffect(() => {
    if (value !== localValue) {
      setLocalValue(value);
    }
  }, [value]);
  
  // Auto-save to localStorage
  useEffect(() => {
    if (!autoSave) return;
    
    const timeout = setTimeout(() => {
      localStorage.setItem("meridian-editor-draft", localValue);
      setLastSaved(new Date());
    }, 2000);
    
    return () => clearTimeout(timeout);
  }, [localValue, autoSave]);
  
  const handleChange = useCallback((newValue: string) => {
    setLocalValue(newValue);
    onChange(newValue);
    
    // Run lint check
    if (onLintViolation) {
      const violations = runLintRules(newValue);
      onLintViolation(violations);
    }
  }, [onChange, onLintViolation]);
  
  const insertMarkdown = useCallback((syntax: string, wrap: boolean = false) => {
    const textarea = document.querySelector("textarea[data-editor]") as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = localValue.substring(start, end);
    
    let newValue: string;
    let cursorPos: number;
    
    if (wrap && selected) {
      newValue = localValue.substring(0, start) + syntax + selected + syntax + localValue.substring(end);
      cursorPos = end + syntax.length * 2;
    } else {
      newValue = localValue.substring(0, start) + syntax + localValue.substring(end);
      cursorPos = start + syntax.length;
    }
    
    handleChange(newValue);
    
    // Restore cursor position
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorPos, cursorPos);
    }, 0);
  }, [localValue, handleChange]);
  
  return (
    <div className={cn("vx-card overflow-hidden", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-[rgba(0,0,0,0.06)] px-3 py-2 bg-[rgba(255,255,255,0.50)]">
        <ToolbarButton onClick={() => insertMarkdown("**", true)} title="Bold">
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("_", true)} title="Italic">
          <span className="italic">I</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("~~", true)} title="Strikethrough">
          <span className="line-through">S</span>
        </ToolbarButton>
        
        <div className="w-px h-4 bg-[rgba(0,0,0,0.08)] mx-1" />
        
        <ToolbarButton onClick={() => insertMarkdown("# ")} title="Heading 1">
          H1
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("## ")} title="Heading 2">
          H2
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("### ")} title="Heading 3">
          H3
        </ToolbarButton>
        
        <div className="w-px h-4 bg-[rgba(0,0,0,0.08)] mx-1" />
        
        <ToolbarButton onClick={() => insertMarkdown("- ")} title="Bullet list">
          •
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("1. ")} title="Numbered list">
          1.
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("- [ ] ")} title="Task list">
          ☑
        </ToolbarButton>
        
        <div className="w-px h-4 bg-[rgba(0,0,0,0.08)] mx-1" />
        
        <ToolbarButton onClick={() => insertMarkdown("`", true)} title="Inline code">
          {"</>"}
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("```\n\n```", false)} title="Code block">
          {"{ }"}
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("> ")} title="Quote">
          "
        </ToolbarButton>
        <ToolbarButton onClick={() => insertMarkdown("---")} title="Horizontal rule">
          —
        </ToolbarButton>
        
        <div className="ml-auto flex items-center gap-3 text-xs text-[#6B7280]">
          <span>{wordCount(localValue)} words</span>
          <span>{readingTime(localValue)} min read</span>
          {lastSaved && (
            <span className="text-[#4BA87A]">Saved</span>
          )}
        </div>
      </div>
      
      {/* Editor + Preview split */}
      <div className="flex" style={{ minHeight }}>
        <textarea
          data-editor
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder || "Start writing..."}
          className="flex-1 p-4 resize-none focus:outline-none bg-transparent font-mono text-sm"
          style={{ minHeight }}
        />
        
        <div className="w-px bg-[rgba(0,0,0,0.04)]" />
        
        <div 
          className="flex-1 p-4 overflow-auto prose prose-sm max-w-none"
          style={{ minHeight }}
        >
          <MarkdownPreview content={localValue} />
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ 
  onClick, 
  children, 
  title 
}: { 
  onClick: () => void; 
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="px-2 py-1 text-sm text-[#4A5568] hover:text-[#1A1F36] hover:bg-[rgba(0,0,0,0.04)] rounded transition-colors"
    >
      {children}
    </button>
  );
}

/**
 * Simple markdown preview renderer
 */
function MarkdownPreview({ content }: { content: string }) {
  // In production, use a proper markdown renderer like react-markdown
  return (
    <div 
      className="text-sm text-[#1A1F36]"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}

function renderMarkdown(text: string): string {
  // Basic markdown rendering - in production use react-markdown
  let html = text
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.+)$/gm, "<h3 class='text-lg font-semibold mt-4 mb-2'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='text-xl font-semibold mt-5 mb-2'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='text-2xl font-bold mt-6 mb-3'>$1</h1>")
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Strikethrough
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    // Code
    .replace(/`(.+?)`/g, "<code class='px-1 py-0.5 bg-[rgba(0,0,0,0.04)] rounded text-sm font-mono'>$1</code>")
    // Links
    .replace(/\[(.+?)\]\((.+?)\)/g, "<a href='$2' class='text-[#0D5639] hover:underline'>$1</a>")
    // Lists
    .replace(/^- (.+)$/gm, "<li class='ml-4'>$1</li>")
    .replace(/^(\d+)\. (.+)$/gm, "<li class='ml-4 list-decimal'>$2</li>")
    // Task lists
    .replace(/- \[ \] (.+)$/gm, "<li class='ml-4'>☐ $1</li>")
    .replace(/- \[x\] (.+)$/gm, "<li class='ml-4'>☑ $1</li>")
    // Blockquotes
    .replace(/^> (.+)$/gm, "<blockquote class='border-l-2 border-[#0D5639]/30 pl-3 italic text-[#4A5568]'>$1</blockquote>")
    // Paragraphs
    .replace(/\n\n/g, "</p><p class='mb-3'>")
    // Horizontal rules
    .replace(/^---$/gm, "<hr class='my-4 border-t border-[rgba(0,0,0,0.08)]'/>");
  
  return `<p class='mb-3'>${html}</p>`;
}

/**
 * Lint violation type
 */
export interface LintViolation {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
  rule: string;
}

/**
 * Lint rules for content validation
 */
const LINT_RULES = {
  maxLineLength: { max: 120, message: "Lines should be under 120 characters" },
  minWordCount: { min: 50, message: "Content should have at least 50 words" },
  requiresHeading: { message: "Document should start with a heading" },
  noTrailingWhitespace: { message: "Lines should not have trailing whitespace" },
  requiresBlankLineBeforeHeading: { message: "Headings should be preceded by a blank line" },
};

/**
 * Run lint rules on content
 */
export function runLintRules(content: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const lines = content.split("\n");
  
  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    
    // Check line length
    if (line.length > LINT_RULES.maxLineLength.max) {
      violations.push({
        line: lineNum,
        column: LINT_RULES.maxLineLength.max,
        message: LINT_RULES.maxLineLength.message,
        severity: "warning",
        rule: "max-line-length",
      });
    }
    
    // Check trailing whitespace
    if (line.trimEnd() !== line) {
      violations.push({
        line: lineNum,
        column: line.length,
        message: LINT_RULES.noTrailingWhitespace.message,
        severity: "info",
        rule: "no-trailing-whitespace",
      });
    }
    
    // Check blank line before heading
    if (/^#+ /.test(line) && idx > 0 && lines[idx - 1].trim() !== "") {
      violations.push({
        line: lineNum,
        column: 1,
        message: LINT_RULES.requiresBlankLineBeforeHeading.message,
        severity: "info",
        rule: "heading-preceding-blank-line",
      });
    }
  });
  
  // Check for heading
  if (lines.length > 0 && !/^#+ /.test(lines[0])) {
    violations.push({
      line: 1,
      column: 1,
      message: LINT_RULES.requiresHeading.message,
      severity: "warning",
      rule: "requires-heading",
    });
  }
  
  return violations;
}

/**
 * Word count helper
 */
export function wordCount(text: string): number {
  return text
    .replace(/[#*_~`>\[\]()!]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Reading time helper (250 words/minute)
 */
export function readingTime(text: string): number {
  return Math.max(1, Math.ceil(wordCount(text) / 250));
}

/**
 * Document template for common report types
 */
export const REPORT_TEMPLATES = {
  executive: `# Executive Summary

## Overview
[Brief overview of the analysis scope and objectives]

## Key Findings
- Finding 1
- Finding 2

## Recommendations
1. Recommendation 1
2. Recommendation 2

## Next Steps
[Outline of recommended next steps]
`,

  technical: `# Technical Report

## Introduction
[Background and context]

## Methodology
[Description of analysis approach]

## Results
### Finding 1
[Details]

### Finding 2
[Details]

## Impact Analysis
[Assessment of findings on system]

## Remediation
[Steps to address findings]
`,

  stewardship: `# Data Quality Remediation Report

## Summary
Total records reviewed: [X]
Findings identified: [Y]
Records remediated: [Z]

## Findings by Module
| Module | Count | Severity |
|--------|-------|----------|
| [Name] | [N] | [Level] |

## Action Items
- [ ] Action 1
- [ ] Action 2
`,
};
