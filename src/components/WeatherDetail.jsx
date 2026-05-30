export default function WeatherDetail({ weather, isLiveMode, scenarioWeather, advisory, advisoryLoading }) {
  if (!weather && isLiveMode) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center min-h-[160px]">
        <span className="text-sm text-gray-400">Fetching weather...</span>
      </div>
    )
  }

  if (weather?.stale) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-amber-800 mb-1">Weather — Shipping Lanes</div>
        <p className="text-xs text-amber-700">Data unavailable — API unreachable, showing last known values</p>
      </div>
    )
  }

  function windColor(v) { return v > 62 ? 'text-red-600' : v > 38 ? 'text-amber-500' : 'text-green-600' }
  function waveColor(v) { return v > 3.0 ? 'text-red-600' : v > 1.5 ? 'text-amber-500' : 'text-green-600' }

  const displayStrait   = isLiveMode ? weather?.strait   : scenarioWeather?.strait
  const displaySgStrait = isLiveMode ? weather?.sgStrait : scenarioWeather?.sgStrait
  const sourceLabel     = isLiveMode ? '● Live' : '~ Scenario'

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-800">Weather — Shipping Lanes</span>
        {isLiveMode
          ? <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />Live</span>
          : <span className="text-xs text-gray-900">Scenario</span>
        }
      </div>

      <div className="space-y-2 mb-3">
        <div className="text-xs text-gray-500 font-medium">Malacca Strait</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-lg p-2.5">
            <div className="text-xs text-gray-500 mb-1">Wind</div>
            <div className={`text-lg font-bold ${windColor(displayStrait?.wind_kmh ?? 0)}`}>{displayStrait?.wind_kmh ?? '—'} km/h</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5">
            <div className="text-xs text-gray-500 mb-1">Wave</div>
            <div className={`text-lg font-bold ${waveColor(displayStrait?.wave_m ?? 0)}`}>{displayStrait?.wave_m ?? '—'}m</div>
          </div>
        </div>

        {displaySgStrait && (
          <>
            <div className="text-xs text-gray-500 font-medium pt-1">Singapore Strait</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-xs text-gray-500 mb-1">Wind</div>
                <div className={`text-lg font-bold ${windColor(displaySgStrait.wind_kmh)}`}>{displaySgStrait.wind_kmh} km/h</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-xs text-gray-500 mb-1">Wave</div>
                <div className={`text-lg font-bold ${waveColor(displaySgStrait.wave_m)}`}>{displaySgStrait.wave_m}m</div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
        <div className="text-xs text-blue-600 font-medium mb-1.5">◈ AI-generated advisory</div>
        {advisoryLoading ? (
          <div className="space-y-1.5">
            <div className="h-2.5 bg-blue-100 rounded animate-pulse w-full" />
            <div className="h-2.5 bg-blue-100 rounded animate-pulse w-4/5" />
          </div>
        ) : advisory ? (
          <p className="text-xs text-gray-700 leading-relaxed">{advisory}</p>
        ) : (
          <p className="text-xs text-gray-400">Advisory generated when risk is Medium or High</p>
        )}
      </div>
    </div>
  )
}
