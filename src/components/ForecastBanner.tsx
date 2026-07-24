import { CloudLightning } from "lucide-react";
import { DOCTRINE } from "../sim";
import { firstGustBreach } from "../utils/weatherMapper";
import { useSimStore } from "../store/simStore";

// D-75: lead-time weather warning on the Monitor. Scans the live hourly gust
// forecast for the first crossing of a crane suspension limit. Suppressed while
// a suspension is already active (alerts own that) and when no live forecast
// exists — the banner is about foresight, never about the present.
export function ForecastBanner({ onOpenWeather }: { onOpenWeather: () => void }) {
  const forecast = useSimStore((s) => s.weatherForecast);
  const sim = useSimStore((s) => s.sim);

  if (forecast.length === 0) return null;
  if (sim.wxOps.stsSuspended || sim.wxOps.rtgSuspended) return null;

  const breach = firstGustBreach(forecast, Date.now(), {
    stsKts: DOCTRINE.crane.stsSuspendGustKts,
    rtgKts: DOCTRINE.crane.rtgSuspendGustKts,
  });
  if (!breach || breach.inHours === 0) return null;

  const working = sim.vessels.filter((v) => v.status === "alongside" && v.workProgress < 1).length;
  const scope = breach.scope === "ALL" ? "ALL crane operations" : "STS crane operations";

  return (
    <button
      type="button"
      onClick={onOpenWeather}
      className="flex w-full items-center gap-2 rounded-lg border border-[#eda100]/40 bg-[#eda100]/10 px-3 py-2 text-left text-sm text-[#8a5a00] hover:bg-[#eda100]/15 dark:text-[#eda100]"
    >
      <CloudLightning className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium">Forecast:</span> gusts ~{breach.gustKts} kt in ~{breach.inHours} h — at/above the{" "}
        {breach.limitKts} kt limit, {scope} would suspend [OPS-CRANE §1]. {working} vessel{working === 1 ? "" : "s"} currently
        working. Plan ahead.
      </span>
      <span className="ml-auto shrink-0 text-xs text-[#8a5a00]/70 dark:text-[#eda100]/70">live forecast →</span>
    </button>
  );
}
