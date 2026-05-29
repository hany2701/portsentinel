export function mapWeatherRisk(wind_kmh, wave_m) {
  if (wind_kmh > 62 || wave_m > 3.0) return 'High'   // Beaufort 8+
  if (wind_kmh > 38 || wave_m > 1.5) return 'Medium'  // Beaufort 5–7
  return 'Low'
}
