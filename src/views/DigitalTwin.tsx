import { Suspense, lazy } from "react";
import { Boxes } from "lucide-react";
import { TwinErrorBoundary } from "../twin/TwinErrorBoundary";
import type { ViewProps } from "./registry";

// Lazy chunk: three.js + the whole twin load only when this view is opened (§7).
const TwinView = lazy(() => import("../twin/TwinView"));

function Loading() {
  return (
    <div className="flex h-[calc(100vh-8.5rem)] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <Boxes className="h-8 w-8 animate-pulse" aria-hidden="true" />
        <p className="text-sm">Loading 3D digital twin…</p>
      </div>
    </div>
  );
}

export function DigitalTwin({ onNavigate }: ViewProps) {
  return (
    <div className="w-full">
      <TwinErrorBoundary>
        <Suspense fallback={<Loading />}>
          <TwinView onNavigate={onNavigate} />
        </Suspense>
      </TwinErrorBoundary>
    </div>
  );
}
