import { WEATHER_POINTS } from "../sim/config";

// Thin fetch wrapper around Open-Meteo (keyless, CORS-enabled — D-17). Two fixed points
// (Tuas, mid-Strait): the forecast API carries wind/gust/precip/visibility + an hourly
// gust forecast; the marine API carries wave height. Transformation lives in weatherMapper.

export type OpenMeteoForecast = {
  current: {
    time: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    wind_direction_10m: number;
    precipitation: number;
    visibility: number;
  };
  hourly: { time: number[]; wind_gusts_10m: number[] };
};

export type OpenMeteoMarine = {
  current: { time: number; wave_height: number };
};

export type OpenMeteoRaw = {
  forecast: OpenMeteoForecast[]; // [tuas, strait]
  marine: OpenMeteoMarine[]; // [tuas, strait]
};

const POINTS = [WEATHER_POINTS.tuas, WEATHER_POINTS.strait];

function forecastUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,visibility",
    hourly: "wind_gusts_10m",
    wind_speed_unit: "kn",
    timeformat: "unixtime",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

function marineUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "wave_height",
    timeformat: "unixtime",
  });
  return `https://marine-api.open-meteo.com/v1/marine?${p}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchRawWeather(): Promise<OpenMeteoRaw> {
  const [forecast, marine] = await Promise.all([
    Promise.all(POINTS.map((pt) => getJson<OpenMeteoForecast>(forecastUrl(pt.latitude, pt.longitude)))),
    Promise.all(POINTS.map((pt) => getJson<OpenMeteoMarine>(marineUrl(pt.latitude, pt.longitude)))),
  ]);
  return { forecast, marine };
}
