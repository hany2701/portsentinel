import { useEffect, useState } from "react";
import type { TileSource } from "./tileSource";

// GR-8: is the imagery provider actually reachable right now? A single probe
// tile is loaded when the Maritime Network mounts (lazy — no cost on other
// views). The result drives BOTH the fallback decision and the source-status
// indicator, so imagery failure, offline, or a bad/absent key all resolve to
// the same clean "use the vector basemap" outcome. Nothing here touches the
// simulation; the probe is a plain <img>, not a fetch into app state.

export type SatelliteHealth = "disabled" | "probing" | "ok" | "failed";

const PROBE_TIMEOUT_MS = 8000;

export function useSatelliteHealth(source: TileSource): SatelliteHealth {
  const [health, setHealth] = useState<SatelliteHealth>(
    source.available ? "probing" : "disabled",
  );

  useEffect(() => {
    if (!source.available) {
      setHealth("disabled");
      return;
    }
    setHealth("probing");

    let settled = false;
    const done = (result: SatelliteHealth) => {
      if (settled) return;
      settled = true;
      setHealth(result);
    };

    const img = new Image();
    img.onload = () => done("ok");
    img.onerror = () => done("failed");
    // A low-zoom tile: small, cached by the provider, quick to answer.
    img.src = source.tileUrl(1, 1, 2);
    const timer = window.setTimeout(() => done("failed"), PROBE_TIMEOUT_MS);

    return () => {
      settled = true;
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [source]);

  return health;
}
