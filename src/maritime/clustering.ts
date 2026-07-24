// GR-2: grid clustering for the global map. Clusters are DERIVED from real
// vessel entities — never a separate fake count (acceptance criterion 7), so
// the counts always sum back to the vessels that went in.

export type ClusterInput = { id: string; latitude: number; longitude: number };

export type VesselCluster = {
  id: string;
  latitude: number; // centroid of the members
  longitude: number;
  count: number;
  memberIds: string[];
};

/**
 * Bucket points into a fixed lat/long grid and average each bucket. `cellDeg`
 * comes from the zoom level, so the same vessels resolve from a few large
 * clusters at world zoom to individual markers as the map zooms in.
 *
 * Deterministic: buckets are emitted in sorted key order and members keep their
 * input order, so the same state always renders the same clusters.
 */
export function clusterVessels(items: readonly ClusterInput[], cellDeg: number): VesselCluster[] {
  if (cellDeg <= 0) throw new Error("clusterVessels: cellDeg must be positive");

  const buckets = new Map<string, ClusterInput[]>();
  for (const item of items) {
    const row = Math.floor(item.latitude / cellDeg);
    const col = Math.floor(item.longitude / cellDeg);
    const key = `${row}:${col}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, members]) => ({
      id: `CL-${key}`,
      latitude: members.reduce((s, m) => s + m.latitude, 0) / members.length,
      longitude: members.reduce((s, m) => s + m.longitude, 0) / members.length,
      count: members.length,
      memberIds: members.map((m) => m.id),
    }));
}

// Grid size by zoom. Coarse at world zoom so the global picture reads as traffic
// density; fine as the map closes in, until the regional view draws vessels
// individually and clustering stops being used at all.
export function clusterCellDeg(zoom: number): number {
  if (zoom < 2) return 20;
  if (zoom < 3) return 12;
  if (zoom < 4) return 8;
  return 4;
}
