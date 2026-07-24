import { useCallback, useRef, useState } from "react";
import { useSimStore } from "../store/simStore";
import type { EntityRef } from "../sim";
import type { ViewId } from "../views/registry";
import { TwinCanvas } from "./TwinCanvas";
import { TwinErrorBoundary } from "./TwinErrorBoundary";
import { Toolbar } from "./Toolbar";
import { Inspector } from "./Inspector";
import { ListFilter } from "lucide-react";
import { TwinLegend } from "./Legend";
import { MapDock } from "../maritime/map/MapDock";
import { DEFAULT_LAYERS, type Layers } from "./Scene";
import { OVERVIEW_GOAL, PRESETS, type CamGoal, type CamPreset } from "./camera";
import { entityAnchor } from "./resolve";

// The full Digital Twin view: canvas + toolbar + inspector + legend. Selection lives
// in the store (so the inspector and dashboard react); camera goal and layer toggles
// are local UI state. Default export so it can be a lazy chunk.
export default function TwinView({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);

  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [goal, setGoal] = useState<CamGoal>(OVERVIEW_GOAL);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [crash, setCrash] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPick = useCallback((ref: EntityRef, double: boolean) => {
    select(ref);
    if (double) {
      const a = entityAnchor(sim, ref);
      if (a) setGoal((g) => ({ pos: [a[0] - 12, 16, a[2] + 16], target: [a[0], 0, a[2]], nonce: g.nonce + 1 }));
    }
  }, [sim, select]);

  const onPreset = (p: CamPreset) => setGoal((g) => ({ ...PRESETS[p], nonce: g.nonce + 1 }));
  const onLayer = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const onFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-8.5rem)] w-full overflow-hidden rounded-lg border border-slate-200 bg-[#0b1220] dark:border-slate-800">
      <Toolbar
        layers={layers}
        onLayer={onLayer}
        onPreset={onPreset}
        onReset={() => onPreset("Overview")}
        onFullscreen={onFullscreen}
        showLegend={showLegend}
        onToggleLegend={() => setShowLegend((v) => !v)}
        onCrash={() => setCrash(true)}
      />
      <TwinErrorBoundary onRetry={() => setCrash(false)}>
        <TwinCanvas
          sim={sim}
          layers={layers}
          goal={goal}
          crash={crash}
          selection={selection}
          hoverId={hoverId}
          onPick={onPick}
          onHover={setHoverId}
          onBackground={() => select(null)}
        />
      </TwinErrorBoundary>
      <Inspector onNavigate={onNavigate} />
      {/* Same dock the Maritime Network uses, so the two views share one legend
          treatment. The toolbar's legend toggle now controls whether the dock is
          mounted at all; the chip itself opens and closes the panel. */}
      {showLegend && (
        <MapDock
          open={legendOpen ? "legend" : null}
          onOpenChange={(id) => setLegendOpen(id === "legend")}
          items={[
            {
              id: "legend",
              label: "Legend",
              icon: <ListFilter className="h-3 w-3" aria-hidden="true" />,
              width: "w-[22rem]",
              content: <TwinLegend />,
            },
          ]}
        />
      )}
    </div>
  );
}
