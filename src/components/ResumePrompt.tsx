import { History } from "lucide-react";
import type { SavedSession } from "../store/persistence";

// D-76: shown once at boot when a saved session exists. Resume restores the
// world paused; Start fresh clears the save and keeps the new genesis world.
export function ResumePrompt({ saved, onResume, onFresh }: { saved: SavedSession; onResume: () => void; onFresh: () => void }) {
  const age = Math.max(0, Math.round((Date.now() - saved.savedAtMs) / 60_000));
  return (
    <div className="fixed inset-x-0 top-16 z-50 mx-auto w-fit rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <History className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <p className="text-sm text-slate-700 dark:text-slate-200">
          Saved session found — tick {saved.sim.clock.tick}, saved {age < 1 ? "moments" : `~${age} min`} ago.
        </p>
        <button
          type="button"
          onClick={onResume}
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={onFresh}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
}
