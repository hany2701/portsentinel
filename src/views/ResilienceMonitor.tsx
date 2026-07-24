import { KpiRow } from "../components/KpiRow";
import { TerminalKpiRow } from "../components/TerminalKpiRow";
import { ForecastBanner } from "../components/ForecastBanner";
import { ResilienceHero, CockpitDetail } from "../components/Cockpit";
import { MaritimeSummaryCard } from "../components/MaritimeSummaryCard";
import { DecisionQueue } from "../components/DecisionQueue";
import type { ViewProps } from "./registry";

export function ResilienceMonitor({ onNavigate }: ViewProps) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 2xl:max-w-none">
      <ForecastBanner onOpenWeather={() => onNavigate("weather")} />
      {/* D-112: the resilience score leads the view as a full-width hero band. */}
      <ResilienceHero />
      <KpiRow />
      <TerminalKpiRow />
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="space-y-4">
          {/* Scenario controls now live in the header, beside alerts and the
              simulation panel, so they are reachable from every view. */}
          <CockpitDetail />
          <DecisionQueue />
        </div>
        <div className="space-y-4 xl:col-span-2">
          {/* The Maritime Network summary replaces the Port Overview card: an
              entry point into the full tab, not a second map. The 3D twin
              remains reachable from its own Digital Twin tab. */}
          <MaritimeSummaryCard onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}
