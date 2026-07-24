import { rand, randInt, randRange, pick } from "./rng";
import { SERVICE_ROSTER } from "./roster";
import { TRANSSHIP_SHARE, MAX_ITEM_TEU } from "./config";
import type { CargoManifestItem, CargoType, Customer, Rng, SizeMix, VesselClass } from "./types";

// REAL-2 (D-80): pick an onward service for a transshipment box — any service on
// the roster other than the inbound one (a box transships from one loop to
// another). Weighted by the onward service's class size so its inbound volume
// tracks its lift capacity: big mainline loops (neopanamax) carry the bulk and
// feeders distribute the rest, exactly as a hub works. Uniform assignment would
// drown the small feeder services in boxes their vessels can't lift. One rng draw.
const ONWARD_WEIGHT: Record<VesselClass, number> = { feeder: 550, panamax: 2500, neopanamax: 6000 };
export function pickOnwardService(rng: Rng, inboundServiceId: string): string {
  const others = SERVICE_ROSTER.filter((s) => s.id !== inboundServiceId);
  const totalW = others.reduce((sum, s) => sum + ONWARD_WEIGHT[s.class], 0);
  let r = rand(rng) * totalW;
  for (const s of others) {
    r -= ONWARD_WEIGHT[s.class];
    if (r <= 0) return s.id;
  }
  return others[others.length - 1].id;
}

export const CLASS_SPEC: Record<VesselClass, { teuMin: number; teuMax: number; lengthM: number; alongsideTicks: [number, number] }> = {
  feeder: { teuMin: 300, teuMax: 800, lengthM: 150, alongsideTicks: [10, 16] },
  panamax: { teuMin: 1500, teuMax: 3500, lengthM: 290, alongsideTicks: [16, 24] },
  neopanamax: { teuMin: 4000, teuMax: 8000, lengthM: 360, alongsideTicks: [22, 32] },
};

export function makeSizeMix(rng: Rng, teu: number): SizeMix {
  const fortyFraction = randRange(rng, 0.45, 0.7);
  const fortyFt = Math.max(0, Math.round((teu * fortyFraction) / 2));
  const twentyFt = Math.max(0, teu - fortyFt * 2);
  return { twentyFt, fortyFt };
}

export function containerCount(mix: SizeMix): number {
  return mix.twentyFt + mix.fortyFt;
}

export function pickClass(rng: Rng): VesselClass {
  const r = rand(rng);
  if (r < 0.45) return "feeder";
  if (r < 0.8) return "panamax";
  return "neopanamax";
}

export function generateManifest(
  rng: Rng,
  nextId: () => string,
  customers: Customer[],
  vclass: VesselClass,
  inboundServiceId: string,
): CargoManifestItem[] {
  const spec = CLASS_SPEC[vclass];
  const total = randInt(rng, spec.teuMin, spec.teuMax);
  const manifest: CargoManifestItem[] = [];
  // Split the total into yard-lot-sized items, each <= MAX_ITEM_TEU so it always
  // fits a block (D-80). A big vessel therefore lands several lots.
  let remaining = total;
  while (remaining > 0) {
    const q = Math.min(remaining, randInt(rng, Math.min(300, remaining), Math.min(MAX_ITEM_TEU, remaining)));
    remaining -= q;
    const customer = pick(rng, customers);
    const type: CargoType =
      customer.temperatureSensitive && rand(rng) < 0.5 ? "reefer" : rand(rng) < 0.08 ? "hazmat" : "standard";
    const mix = makeSizeMix(rng, q);
    // REAL-2 (D-80): ~85% of boxes are transshipment, bound for an onward service.
    const connectingServiceId = rand(rng) < TRANSSHIP_SHARE ? pickOnwardService(rng, inboundServiceId) : undefined;
    manifest.push({
      id: nextId(), quantityTEU: q, containerCount: containerCount(mix), sizeMix: mix,
      type, customerId: customer.id, priority: customer.defaultPriority, connectingServiceId,
    });
  }
  return manifest;
}
