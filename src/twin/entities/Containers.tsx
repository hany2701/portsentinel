import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { yardBlockUtilisationPct } from "../../sim";
import type { SimState } from "../../sim";
import { BOX, MAX_STACK, STACK_COLS, STACK_ROWS, stackPos } from "../layout";
import { CARGO_COLORS, yardBandColor } from "../colors";

// Representative container stacks generated from aggregated block TEU (D-19 — never
// one object per container). Boxes are grouped by color and drawn with one
// instanced mesh per color: ≤ 3 draw calls, ≤ ~576 boxes total (§7 budget).
const CAP = STACK_COLS * STACK_ROWS * MAX_STACK * 8; // capacity per color bucket

function buildGroups(sim: SimState, heatmap: boolean): Map<string, THREE.Vector3[]> {
  const groups = new Map<string, THREE.Vector3[]>();
  for (const block of sim.yardBlocks) {
    const util = yardBlockUtilisationPct(sim, block.id);
    const type = block.hazmat ? "hazmat" : block.reeferPowered ? "reefer" : "standard";
    const color = heatmap ? yardBandColor(util) : CARGO_COLORS[type];
    const arr = groups.get(color) ?? [];
    // Fill level-by-level so stacks grow evenly with utilization.
    let n = Math.round(Math.min(1, util / 100) * STACK_COLS * STACK_ROWS * MAX_STACK);
    for (let level = 0; level < MAX_STACK && n > 0; level++) {
      for (let row = 0; row < STACK_ROWS && n > 0; row++) {
        for (let col = 0; col < STACK_COLS && n > 0; col++) {
          const p = stackPos(block.id, col, row);
          arr.push(new THREE.Vector3(p.x, BOX * (level + 0.5) + 0.1, p.z));
          n--;
        }
      }
    }
    groups.set(color, arr);
  }
  return groups;
}

function ColorBucket({ color, positions }: { color: string; positions: THREE.Vector3[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => { m.setPosition(p); mesh.setMatrixAt(i, m); });
    mesh.count = positions.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, CAP]} castShadow receiveShadow>
      <boxGeometry args={[BOX, BOX, BOX]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </instancedMesh>
  );
}

export function Containers({ sim, heatmap }: { sim: SimState; heatmap: boolean }) {
  const groups = useMemo(() => buildGroups(sim, heatmap), [sim, heatmap]);
  return (
    <group>
      {[...groups.entries()].map(([color, positions]) => (
        <ColorBucket key={color} color={color} positions={positions} />
      ))}
    </group>
  );
}
