import {
  ROUTE_EDGES,
  ROUTE_NODES,
  SHIPPING_CORRIDORS,
  routeNodeById,
  type RouteEdge,
} from "./network";

// GR-1: adjacency over the static network, plus validateNetwork() — the
// maritime counterpart of twin/layout.ts's validateLayout(). Everything here is
// derived once at module load from immutable data, so it is safe to share.

export type Adjacency = ReadonlyMap<string, readonly { edge: RouteEdge; toNodeId: string }[]>;

function buildAdjacency(): Adjacency {
  const adj = new Map<string, { edge: RouteEdge; toNodeId: string }[]>();
  const add = (from: string, to: string, edge: RouteEdge) => {
    const list = adj.get(from);
    if (list) list.push({ edge, toNodeId: to });
    else adj.set(from, [{ edge, toNodeId: to }]);
  };
  for (const edge of ROUTE_EDGES) {
    // Links are declared once and traversable both ways.
    add(edge.fromNodeId, edge.toNodeId, edge);
    add(edge.toNodeId, edge.fromNodeId, edge);
  }
  // Deterministic neighbour order — Dijkstra's tie-breaks must not depend on
  // declaration order in the link table.
  for (const list of adj.values()) list.sort((a, b) => (a.toNodeId < b.toNodeId ? -1 : 1));
  return adj;
}

export const ADJACENCY: Adjacency = buildAdjacency();

export function neighboursOf(nodeId: string): readonly { edge: RouteEdge; toNodeId: string }[] {
  return ADJACENCY.get(nodeId) ?? [];
}

export function edgeBetween(fromNodeId: string, toNodeId: string): RouteEdge | undefined {
  return neighboursOf(fromNodeId).find((n) => n.toNodeId === toNodeId)?.edge;
}

// True when every consecutive pair in the sequence is a single graph hop.
export function isConnectedSequence(nodeIds: readonly string[]): boolean {
  if (nodeIds.length < 2) return nodeIds.length === 1 && routeNodeById(nodeIds[0]) !== undefined;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    if (!edgeBetween(nodeIds[i], nodeIds[i + 1])) return false;
  }
  return true;
}

// Total great-circle distance along a connected node sequence.
export function sequenceDistanceNm(nodeIds: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const edge = edgeBetween(nodeIds[i], nodeIds[i + 1]);
    if (!edge) throw new Error(`Route sequence is not connected at ${nodeIds[i]}→${nodeIds[i + 1]}`);
    total += edge.distanceNm;
  }
  return total;
}

/**
 * Structural validation of the static network. Throws on the first violation,
 * mirroring twin/layout.ts::validateLayout(). Called by the network tests and
 * by the dev route-graph inspector; never silently repairs the data.
 */
export function validateNetwork(): void {
  const ids = new Set<string>();
  for (const node of ROUTE_NODES) {
    if (ids.has(node.id)) throw new Error(`Duplicate route node id: ${node.id}`);
    ids.add(node.id);
    if (!Number.isFinite(node.latitude) || node.latitude < -90 || node.latitude > 90)
      throw new Error(`Node ${node.id} has an out-of-range latitude: ${node.latitude}`);
    if (!Number.isFinite(node.longitude) || node.longitude < -180 || node.longitude > 180)
      throw new Error(`Node ${node.id} has an out-of-range longitude: ${node.longitude}`);
  }

  const seenLinks = new Set<string>();
  for (const edge of ROUTE_EDGES) {
    if (!ids.has(edge.fromNodeId)) throw new Error(`Edge ${edge.id} starts at unknown node ${edge.fromNodeId}`);
    if (!ids.has(edge.toNodeId)) throw new Error(`Edge ${edge.id} ends at unknown node ${edge.toNodeId}`);
    if (edge.fromNodeId === edge.toNodeId) throw new Error(`Edge ${edge.id} is a self-loop`);
    if (!(edge.distanceNm > 0)) throw new Error(`Edge ${edge.id} has a non-positive distance`);
    // Undirected duplicates would double-count traffic and confuse routing.
    const key = [edge.fromNodeId, edge.toNodeId].sort().join("__");
    if (seenLinks.has(key)) throw new Error(`Duplicate link between ${edge.fromNodeId} and ${edge.toNodeId}`);
    seenLinks.add(key);
  }

  // The whole network must be reachable — an isolated node can never be routed
  // to, and an isolated component would silently break rerouting.
  const start = ROUTE_NODES[0].id;
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const { toNodeId } of neighboursOf(current)) {
      if (!seen.has(toNodeId)) {
        seen.add(toNodeId);
        queue.push(toNodeId);
      }
    }
  }
  if (seen.size !== ROUTE_NODES.length) {
    const missing = ROUTE_NODES.filter((n) => !seen.has(n.id)).map((n) => n.id);
    throw new Error(`Route graph is not fully connected; unreachable: ${missing.join(", ")}`);
  }

  for (const corridor of SHIPPING_CORRIDORS) {
    if (corridor.nodeIds.length < 2) throw new Error(`Corridor ${corridor.id} needs at least two nodes`);
    for (const nodeId of corridor.nodeIds) {
      if (!ids.has(nodeId)) throw new Error(`Corridor ${corridor.id} references unknown node ${nodeId}`);
    }
    if (!isConnectedSequence(corridor.nodeIds))
      throw new Error(`Corridor ${corridor.id} is not edge-connected end to end`);
  }
}
