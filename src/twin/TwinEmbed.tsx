import { Maximize2 } from "lucide-react";
import { useSimStore } from "../store/simStore";
import { TwinCanvas } from "./TwinCanvas";
import { DEFAULT_LAYERS } from "./Scene";
import { OVERVIEW_GOAL } from "./camera";

// Dashboard overview embed (D-41): a non-interactive slow auto-orbit. A full-cover
// overlay button intercepts clicks (so the canvas never steals scroll/drag) and
// navigates to the full Digital Twin view. Default export → shares the twin chunk.
export default function TwinEmbed({ onOpen }: { onOpen: () => void }) {
  const sim = useSimStore((s) => s.sim);
  return (
    <div className="relative h-72 w-full overflow-hidden rounded-md bg-[#0b1220]">
      <TwinCanvas
        sim={sim}
        embed
        layers={{ ...DEFAULT_LAYERS, labels: false }}
        goal={OVERVIEW_GOAL}
        selection={null}
        hoverId={null}
        onPick={() => {}}
        onHover={() => {}}
        onBackground={() => {}}
      />
      <button
        type="button"
        onClick={onOpen}
        className="group absolute inset-0 flex items-end justify-end p-3"
        aria-label="Open the full Digital Twin view"
      >
        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900/70 px-2.5 py-1.5 text-xs font-medium text-white opacity-90 group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          Open Digital Twin
        </span>
      </button>
    </div>
  );
}
