import { useEffect, useRef } from "react";

// Scrolls the currently-selected row/card into view when the selection changes —
// used so an entity opened from the Digital Twin lands visible in a long
// Operations panel. `block: "nearest"` means no scroll when it is already on
// screen (avoids jarring jumps on ordinary intra-tab clicks). Mark the selected
// element with `data-ops-selected="true"`.
export function useScrollSelectedIntoView<T extends HTMLElement>(selectionId: string | null) {
  const containerRef = useRef<T>(null);
  useEffect(() => {
    if (!selectionId) return;
    containerRef.current?.querySelector('[data-ops-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectionId]);
  return containerRef;
}
