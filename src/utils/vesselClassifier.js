// Zones derived from port-operational-zones.geojson Tuas Terminal polygon
// Bounding box: lat 1.210–1.280, lon 103.612–103.657 — divided into 5 equal lat bands
export const TERMINAL_ZONES = {
  T1: { latMin: 1.210, latMax: 1.224, lonMin: 103.612, lonMax: 103.657 },
  T2: { latMin: 1.224, latMax: 1.238, lonMin: 103.612, lonMax: 103.657 },
  T3: { latMin: 1.238, latMax: 1.252, lonMin: 103.612, lonMax: 103.657 },
  T4: { latMin: 1.252, latMax: 1.266, lonMin: 103.612, lonMax: 103.657 },
  T5: { latMin: 1.266, latMax: 1.281, lonMin: 103.612, lonMax: 103.657 }
}

// Western approach anchorage — directly west of Tuas Terminal
export const WAITING_ANCHORAGE = {
  latMin: 1.150, latMax: 1.285, lonMin: 103.450, lonMax: 103.612
}

export const BERTH_CAPACITY = { T1: 4, T2: 5, T3: 5, T4: 6, T5: 4 }

export function classifyVessel(lat, lon, sog) {
  for (const [terminal, zone] of Object.entries(TERMINAL_ZONES)) {
    if (lat >= zone.latMin && lat <= zone.latMax &&
        lon >= zone.lonMin && lon <= zone.lonMax) {
      return {
        location: terminal,
        status: sog < 0.5 ? 'berthed' : 'manoeuvring'
      }
    }
  }
  if (lat >= WAITING_ANCHORAGE.latMin && lat <= WAITING_ANCHORAGE.latMax &&
      lon >= WAITING_ANCHORAGE.lonMin && lon <= WAITING_ANCHORAGE.lonMax) {
    return { location: 'anchorage', status: 'waiting' }
  }
  return { location: 'transit', status: 'transiting' }
}

export function isCargoVessel(typeCode) {
  return typeCode >= 70 && typeCode <= 89
}

export function calcBerthOccupancy(vessels) {
  const counts = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 }
  for (const v of vessels) {
    if (v.status === 'berthed' && counts[v.location] !== undefined) {
      counts[v.location]++
    }
  }
  return Object.fromEntries(
    Object.entries(counts).map(([t, n]) => [
      t, Math.min(100, Math.round((n / BERTH_CAPACITY[t]) * 100))
    ])
  )
}

export function calcWaitMetrics(vessels) {
  const waiting = vessels.filter(v => v.status === 'waiting')
  const congestionMultiplier = waiting.length > 6 ? 1.7 : 1.0
  return {
    waitingCount: waiting.length,
    estimatedWaitHours: Math.round(waiting.length * 3.5 * congestionMultiplier),
    waitingVessels: waiting.map(v => v.name).slice(0, 5)
  }
}
