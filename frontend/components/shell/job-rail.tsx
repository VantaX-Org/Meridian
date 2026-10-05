"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { JobCard, jobPercent } from "@/components/data/job-card";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";

/** Top-bar pulse: jobs in flight, with the recent list on click. A bar shows only when every total is known. */
export function JobRail() {
  const { jobs, active } = useJobs();
  const nowSec = useNowSec(active.length > 0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const known = active.map(jobPercent).filter((p): p is number => p !== null);
  const percent = known.length === active.length && known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null;
  const recent = jobs.slice(0, 8);
  return (
    <div className="aurora-job-rail__wrap" ref={ref}>
      <button type="button" className="aurora-job-rail aurora-focus-ring" data-live={active.length ? "true" : undefined}
        aria-label={active.length ? `${active.length} jobs running` : "Jobs"} aria-expanded={open} title="Jobs"
        onClick={() => setOpen((o) => !o)}>
        <Activity size={14} aria-hidden />
        <span className="aurora-job-rail__count aurora-number">{active.length}</span>
        {percent !== null ? (
          <span className="aurora-job-rail__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ transform: `scaleX(${percent / 100})` }} />
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="aurora-job-rail__panel" role="dialog" aria-label="Jobs">
          <div className="aurora-job-rail__head">
            <span>Jobs</span>
            <Link href="/data?tab=runs" onClick={() => setOpen(false)}>All runs</Link>
          </div>
          {recent.length === 0 ? (
            <p className="aurora-job-rail__empty">Nothing has run yet.</p>
          ) : (
            <ul>
              {recent.map((j) => <li key={j.id}><JobCard job={j} nowSec={nowSec} compact /></li>)}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
