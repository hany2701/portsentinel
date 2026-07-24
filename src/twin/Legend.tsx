import { C, CARGO_COLORS } from "./colors";

// The twin's key. Content is twin-specific; the SHELL and theme come from the
// Maritime Network's MapDock, so both 3D and 2D views carry the same bottom-left
// glass panel with the same chip, rather than two different legend treatments.

const ROWS: { heading: string; items: [string, string][] }[] = [
  {
    heading: "Vessel",
    items: [
      ["Alongside", C.green],
      ["Anchored", C.amber],
      ["Approaching", C.blueLight],
      ["Diverted", C.red],
    ],
  },
  {
    heading: "Berth / yard",
    items: [
      ["Available / <70%", C.green],
      ["Occupied / 70–85%", C.amber],
      ["Closed / >85%", C.red],
    ],
  },
  {
    heading: "AGV",
    items: [
      ["Laden — 20ft", CARGO_COLORS.standard],
      ["Laden — reefer", CARGO_COLORS.reefer],
      ["Crane transfer point", "#f0b429"],
      ["Yard transfer point", "#7f8895"],
    ],
  },
];

export function TwinLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-3 text-xs">
      {ROWS.map((col) => (
        <div key={col.heading}>
          <p className="mb-1 font-semibold text-slate-400">{col.heading}</p>
          {col.items.map(([label, color]) => (
            <div key={label} className="flex items-center gap-1.5 py-0.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
              <span className="text-slate-200">{label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
