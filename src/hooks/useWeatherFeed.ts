import { useEffect } from "react";
import { WEATHER_POLL_MS } from "../sim";
import { useSimStore } from "../store/simStore";

// Drives the wall-clock weather poll: once on mount, then every 10 min. All feed logic
// (fusion, freshness, fallback) lives in the store's pollWeather action.
export function useWeatherFeed() {
  const pollWeather = useSimStore((s) => s.pollWeather);

  useEffect(() => {
    pollWeather();
    const id = setInterval(pollWeather, WEATHER_POLL_MS);
    return () => clearInterval(id);
  }, [pollWeather]);
}
