import { Fragment, useMemo } from "react";
import { CIRCUITS, GRID_LANES, accessStubs, laneLevel, type Pt } from "../agv";

// The painted AGV carriageways (D-63 ruling 5).
//
// Drawn from the SAME circuit geometry the vehicles drive, so a lane can never
// be painted where an AGV does not go — or vice versa. Each circuit is a
// one-way loop, and the two legs of a loop run up and down opposite sides of a
// finger or a yard aisle, which is what makes the lanes read as two-way.
//
// Tone matters as much as position: these sit just above the apron in a slightly
// darker grey rather than the near-black strip the old quay road used, so the
// platform and the fingers still read as one continuous piece of land.

// Three lane levels, drawn at their own widths so the hierarchy is legible:
// the spine and rear circulation carry the yard, the feeders connect berth to
// yard, and the access stubs are short low-speed spurs into a transfer bay.
const LANE_W = { spine: 3, feeder: 2.4, access: 1.8 } as const;
const SURFACE = "#98a1b0";
const ACCESS_SURFACE = "#8d95a4";
const CENTRE_LINE = "#e8ecf3";
const Y = 0.06;

/** One straight carriageway between two lane nodes, plus its dashed centreline. */
function Leg({ a, b, width = LANE_W.feeder, dashed = true }: { a: Pt; b: Pt; width?: number; dashed?: boolean }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) return null;
  const angle = Math.atan2(dx, dz);
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };

  // Dashes every ~3 units, inset from the ends so corners stay clean.
  const dashes = Math.max(0, Math.floor((len - 3) / 3));

  return (
    <group position={[mid.x, 0, mid.z]} rotation={[0, angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y, 0]} receiveShadow>
        <planeGeometry args={[width, len]} />
        <meshStandardMaterial color={dashed ? SURFACE : ACCESS_SURFACE} roughness={1} />
      </mesh>
      {dashed && Array.from({ length: dashes }, (_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, Y + 0.01, -len / 2 + 1.5 + i * 3]}
        >
          <planeGeometry args={[0.14, 1.2]} />
          <meshStandardMaterial color={CENTRE_LINE} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export function AgvLanes() {
  const legs = useMemo(
    () =>
      CIRCUITS.flatMap((c) =>
        c.pts.map((p, i) => ({
          key: `${c.id}-${i}`,
          a: p,
          b: c.pts[(i + 1) % c.pts.length],
          width: LANE_W[laneLevel(c.id)],
        })),
      ),
    [],
  );
  const stubs = useMemo(() => accessStubs(), []);

  return (
    <group>
      {/* The shared horizontal grid: main spine, central cross-aisle (two
          carriageways) and rear circulation. */}
      {GRID_LANES.map((lane, i) => (
        <Leg key={`grid-${i}`} a={lane.a} b={lane.b} width={LANE_W[lane.level]} />
      ))}

      {/* The routes the vehicles actually drive: feeders and quay aprons. */}
      {legs.map((leg) => (
        <Fragment key={leg.key}>
          <Leg a={leg.a} b={leg.b} width={leg.width} />
        </Fragment>
      ))}

      {/* Yard-access stubs: short, narrow, undashed spurs from the feeder lane to
          the block face. They are what makes a bay read as an access point
          rather than a stop painted in the middle of the road. */}
      {stubs.map((s) => (
        <Leg key={`stub-${s.blockId}`} a={s.a} b={s.b} width={LANE_W.access} dashed={false} />
      ))}

      {/* A transfer pad under each stop, so it is clear WHERE a vehicle waits.
          Yard bays are drawn on the block side of the lane centre so the pad
          never covers the lane markings or sits under the block's label. */}
      {CIRCUITS.flatMap((c) =>
        c.stops.map((stop, i) => {
          const acc = c.pts.reduce<{ s: number; pt: Pt | null }>(
            (state, p, idx) => {
              const q = c.pts[(idx + 1) % c.pts.length];
              const len = Math.hypot(q.x - p.x, q.z - p.z);
              if (state.pt === null && state.s + len >= stop.s) {
                const t = len === 0 ? 0 : (stop.s - state.s) / len;
                return { s: state.s + len, pt: { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t } };
              }
              return { s: state.s + len, pt: state.pt };
            },
            { s: 0, pt: null },
          );
          if (!acc.pt) return null;
          const crane = stop.kind === "crane";
          return (
            <mesh
              key={`${c.id}-stop-${i}`}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[acc.pt.x, Y + 0.02, acc.pt.z]}
            >
              <planeGeometry args={[LANE_W.feeder, 3.4]} />
              <meshStandardMaterial
                color={crane ? "#f0b429" : "#cfd6e0"}
                roughness={1}
                transparent
                opacity={crane ? 0.5 : 0.45}
              />
            </mesh>
          );
        }),
      )}
    </group>
  );
}
