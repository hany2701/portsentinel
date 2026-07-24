import { Layers as LayersIcon, LifeBuoy, List, Maximize2, RotateCcw } from "lucide-react";
import type { Layers } from "./Scene";
import type { CamPreset } from "./camera";

const PRESET_LIST: CamPreset[] = ["Overview", "Quay", "Yard", "Gate"];
const LAYER_LIST: { key: keyof Layers; label: string }[] = [
  { key: "labels", label: "Labels" },
  { key: "cranes", label: "Cranes" },
  { key: "agvs", label: "AGVs" },
  { key: "heatmap", label: "Heatmap" },
];

const PILL = "rounded-md px-2.5 py-1 text-xs font-medium transition-colors";
const OFF = "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800";
const ON = "bg-[#2a78d6] text-white";

export function Toolbar({ layers, onLayer, onPreset, onReset, onFullscreen, showLegend, onToggleLegend, onCrash }: {
  layers: Layers;
  onLayer: (k: keyof Layers) => void;
  onPreset: (p: CamPreset) => void;
  onReset: () => void;
  onFullscreen: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
  onCrash: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        {PRESET_LIST.map((p) => (
          <button key={p} type="button" className={`${PILL} ${OFF}`} onClick={() => onPreset(p)}>
            {p}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <LayersIcon className="ml-1 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        {LAYER_LIST.map((l) => (
          <button key={l.key} type="button" aria-pressed={layers[l.key]} className={`${PILL} ${layers[l.key] ? ON : OFF}`} onClick={() => onLayer(l.key)}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <button type="button" aria-pressed={showLegend} aria-label="Legend" title="Legend" className={`rounded-md p-1.5 ${showLegend ? ON : OFF}`} onClick={onToggleLegend}>
          <List className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Reset view" title="Reset view" className={`rounded-md p-1.5 ${OFF}`} onClick={onReset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fullscreen" title="Fullscreen" className={`rounded-md p-1.5 ${OFF}`} onClick={onFullscreen}>
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* D-57: production-visible robustness demo — the crash stays contained
            by the twin's error boundary while the dashboard keeps running. */}
        <button
          type="button"
          aria-label="Test 3D recovery"
          title="Test 3D recovery — simulates a 3D failure to demonstrate contained recovery; the dashboard is unaffected"
          className={`rounded-md p-1.5 ${OFF}`}
          onClick={onCrash}
        >
          <LifeBuoy className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
