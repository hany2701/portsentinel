import { applyCalibrationMode } from "./doctrine";
import { rebuildSearchIndex } from "./searchIndex";
import type { CalibrationMode } from "./types";

// REAL-6 (D-84): the single entry point for switching calibration mode.
// Separate from doctrine.ts's applyCalibrationMode to avoid a circular import
// — searchIndex.ts already imports DOCTRINE_CORPUS from doctrine.ts, so
// doctrine.ts cannot import back into searchIndex.ts. Idempotent: a no-op
// when the mode hasn't actually changed, so calling it defensively on every
// tick (tick.ts) costs nothing once synced.
let current: CalibrationMode | null = null;

export function syncCalibrationMode(mode: CalibrationMode): void {
  if (mode === current) return;
  applyCalibrationMode(mode);
  rebuildSearchIndex();
  current = mode;
}
