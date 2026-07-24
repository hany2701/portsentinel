import { useEffect } from "react";
import { WEATHER_POLL_MS } from "../sim";
import { useSimStore } from "../store/simStore";

// REAL-5 (D-83): drives the wall-clock lightning + haze poll — once on mount,
// then every 10 min (same cadence as the weather feed). All feed logic
// (mapping, freshness, fallback) lives in the store's pollMarineFeeds action.
export function useMarineFeeds() {
  const pollMarineFeeds = useSimStore((s) => s.pollMarineFeeds);

  useEffect(() => {
    pollMarineFeeds();
    const id = setInterval(pollMarineFeeds, WEATHER_POLL_MS);
    return () => clearInterval(id);
  }, [pollMarineFeeds]);
}
