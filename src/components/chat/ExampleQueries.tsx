import { useState } from "react";

// UIX-1: collapsible discoverability. Every query is answerable by the assistant
// against the live snapshot — no fictional prompts.
const QUERIES = [
  "Show vessels at risk of delay.",
  "What happens if I reassign B6?",
  "Which vessels are waiting at anchorage?",
  "Show berth utilisation.",
  "Which cargo is affected by weather disruptions?",
  "Explain the resilience score.",
];

export function ExampleQueries({ onPick }: { onPick: (q: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        {open ? "▾" : "▸"} Example Queries
      </button>
      {open && (
        <div className="space-y-1 px-2 pb-2">
          {QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
