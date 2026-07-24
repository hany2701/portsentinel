import { RefreshCw } from "lucide-react";
import { DOCTRINE, WEATHER_BANDS, weatherRiskBand, CALIBRATION } from "../sim";
import { useSimStore } from "../store/simStore";
import { Panel } from "../components/Panel";
import { Gauge } from "../components/Gauge";
import { MarineEnvironmentPanel } from "../components/MarineEnvironmentPanel";
import { WEATHER_BAND_COLOR } from "../twin/colors";
import type { WeatherState } from "../sim";
import type { WeatherForecastPoint } from "../utils/weatherMapper";

const STS_SUSPEND = DOCTRINE.crane.stsSuspendGustKts;

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function compass(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

function FreshnessBadge({ weather }: { weather: WeatherState }) {
  if (weather.stormOverlay) {
    return <Badge className="bg-[#d03b3b]/10 text-[#d03b3b]" dot="bg-[#d03b3b]" text="Simulated storm overlay" />;
  }
  if (weather.freshness === "live") {
    return <Badge className="bg-[#1baf7a]/10 text-[#199e70]" dot="bg-[#199e70]" text={`Live · as of ${clock(weather.asOfMs!)}`} />;
  }
  if (weather.freshness === "stale") {
    return <Badge className="bg-[#eda100]/10 text-[#c98500]" dot="bg-[#c98500]" text={`Stale · last good ${weather.asOfMs ? clock(weather.asOfMs) : "—"}`} />;
  }
  return <Badge className="bg-[#eda100]/10 text-[#c98500]" dot="bg-[#c98500]" text="Simulated fallback" />;
}

function Badge({ className, dot, text }: { className: string; dot: string; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

function ForecastChart({ points }: { points: WeatherForecastPoint[] }) {
  if (points.length < 2) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Hourly forecast is unavailable in simulated mode.</p>;
  }
  const w = 320;
  const h = 96;
  const gusts = points.map((p) => p.gustKts);
  const max = Math.max(STS_SUSPEND + 5, ...gusts);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - (v / max) * (h - 8) - 4;
  const line = gusts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const suspendY = y(STS_SUSPEND);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Hourly gust forecast">
        <line x1="0" x2={w} y1={suspendY} y2={suspendY} strokeDasharray="4 3" className="stroke-[#d03b3b]" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polyline points={line} fill="none" strokeWidth="2" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{clock(points[0].timeMs)}</span>
        <span className="text-[#d03b3b]">— — STS suspend {STS_SUSPEND} kt</span>
        <span>{clock(points[points.length - 1].timeMs)}</span>
      </div>
    </div>
  );
}

export function Weather() {
  const weather = useSimStore((s) => s.sim.weather);
  const forecast = useSimStore((s) => s.weatherForecast);
  const error = useSimStore((s) => s.weatherFeedError);
  const pollWeather = useSimStore((s) => s.pollWeather);
  const band = weatherRiskBand(weather.riskIndex);

  return (
    <div className="mx-auto max-w-7xl space-y-4 2xl:max-w-none">
      {error && (
        <div className="rounded-lg border border-[#eda100]/40 bg-[#eda100]/10 px-4 py-2 text-sm text-[#c98500]">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Malacca Strait & Tuas"
          actions={
            <button
              type="button"
              onClick={() => pollWeather()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </button>
          }
        >
          <div className="mb-3"><FreshnessBadge weather={weather} /></div>
          <Gauge value={weather.riskIndex} label={`Weather risk — ${band.label}`} colorClass={WEATHER_BAND_COLOR[band.id].stroke} />
        </Panel>

        <Panel title="Current Conditions">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Wind" value={`${weather.windKts} kt`} />
            <Metric label="Gusts" value={`${weather.gustKts} kt`} />
            <Metric label="Direction" value={`${compass(weather.windDirDeg)} ${weather.windDirDeg}°`} />
            <Metric label="Wave height" value={`${weather.waveHeightM} m`} />
            <Metric label="Visibility" value={`${weather.visibilityKm} km`} />
            <Metric label="Precipitation" value={`${weather.precipMm} mm`} />
          </div>
        </Panel>

        <Panel title="Gust Forecast (24 h)">
          <ForecastChart points={forecast} />
        </Panel>
      </div>

      <MarineEnvironmentPanel />

      <Panel title="OPS-WX — Weather Risk Bands">
        <div className="flex overflow-hidden rounded-md">
          {WEATHER_BANDS.map((b) => (
            <div
              key={b.id}
              title={b.operationalMeaning}
              className={`flex-1 px-2 py-1 text-center text-xs font-medium text-white ${WEATHER_BAND_COLOR[b.id].bg} ${b.id === band.id ? "ring-2 ring-inset ring-slate-900 dark:ring-white" : "opacity-70"}`}
            >
              {b.label} <span className="opacity-80">{b.minInclusive}–{b.maxInclusive}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          At severe+, divert approaching vessels before they commit. Cranes suspend under lightning
          (OPS-CRANE §1); haze feeds the visibility gate (OPS-WX §2); neopanamax berthing needs an
          open tide window (OPS-TIDE §1).
        </p>
        {/* D-78: honest calibration record — demo thresholds vs production values. */}
        <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-800">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Threshold calibration (demo vs production)</p>
          <ul className="mt-1 space-y-0.5">
            {CALIBRATION.map((c) => (
              <li key={c.label} className="flex items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="min-w-0 flex-1">{c.label}</span>
                <span className="shrink-0 font-mono">{c.demo}</span>
                <span className="shrink-0 text-slate-300 dark:text-slate-600">→</span>
                <span className="shrink-0 font-mono">{c.real}</span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  );
}
