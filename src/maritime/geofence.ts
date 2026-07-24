// GR-1: geographic boundaries. Two of them matter operationally:
//
//  - SINGAPORE_APPROACH_FENCE gates the handover from the geographic engine to
//    the Tuas D-62 twin (GR-D6). Crossing it is a STATUS change, never a
//    coordinate transform: the two frames stay separate.
//  - REGIONAL_BOUNDS defines the regional map scope and which vessels the
//    regional view draws individually rather than as clusters.

export type GeoPoint = { latitude: number; longitude: number };
export type GeoBounds = { south: number; north: number; west: number; east: number };

// Southeast Asia, the Malacca Strait and the approaches to Singapore.
export const REGIONAL_BOUNDS: GeoBounds = { south: -9, north: 16, west: 94, east: 122 };

// The Tuas approach fence: a ring around the western Singapore Strait approach,
// enclosing WPT-SG-APPROACH, WPT-TUAS-HOLDING and NODE-TUAS-ANCHORAGE but not
// WPT-SG-STRAIT-E (which stays regional) or WPT-MALACCA-S. A vessel bound for
// Tuas hands over the first tick it is inside this ring.
export const SINGAPORE_APPROACH_FENCE: readonly GeoPoint[] = [
  { latitude: 1.34, longitude: 103.5 },
  { latitude: 1.34, longitude: 103.84 },
  { latitude: 1.05, longitude: 103.84 },
  { latitude: 1.05, longitude: 103.5 },
];

export function withinBounds(point: GeoPoint, bounds: GeoBounds): boolean {
  return (
    point.latitude >= bounds.south &&
    point.latitude <= bounds.north &&
    point.longitude >= bounds.west &&
    point.longitude <= bounds.east
  );
}

/**
 * Ray-casting point-in-polygon over a lat/long ring. The fences here are small
 * and far from the antimeridian, so planar treatment of degrees is exact enough
 * and keeps the test deterministic.
 */
export function pointInPolygon(point: GeoPoint, ring: readonly GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].latitude;
    const xi = ring[i].longitude;
    const yj = ring[j].latitude;
    const xj = ring[j].longitude;
    const straddles = yi > point.latitude !== yj > point.latitude;
    if (straddles) {
      const crossingLon = ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
      if (point.longitude < crossingLon) inside = !inside;
    }
  }
  return inside;
}

export function inSingaporeApproach(point: GeoPoint): boolean {
  return pointInPolygon(point, SINGAPORE_APPROACH_FENCE);
}

export function inRegionalScope(point: GeoPoint): boolean {
  return withinBounds(point, REGIONAL_BOUNDS);
}
