// Thin fetch wrappers around Singapore's data.gov.sg real-time environment
// APIs (keyless, CORS-enabled — confirmed live) behind REAL-5 (D-83): NEA
// lightning observations and PSI/haze readings. Both mirror weatherClient.ts's
// getJson pattern — a non-OK response throws, and the caller (the store's poll
// action) treats any failure the same way the weather poll already does.

// v2 "weather?api=lightning" is the keyless lightning endpoint — the plain
// v1/v2 "/lightning" paths either don't resolve or demand an API key.
// readings is empty when no lightning is currently observed anywhere.
export type NeaLightningRaw = {
  data?: { records?: { datetime?: string; item?: { readings?: unknown[] } }[] };
};

export type NeaPsiRaw = {
  items?: { timestamp?: string; readings?: { psi_twenty_four_hourly?: Record<string, number> } }[];
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`data.gov.sg ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchLightningRaw(): Promise<NeaLightningRaw> {
  return getJson<NeaLightningRaw>("https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning");
}

export function fetchPsiRaw(): Promise<NeaPsiRaw> {
  return getJson<NeaPsiRaw>("https://api.data.gov.sg/v1/environment/psi");
}
