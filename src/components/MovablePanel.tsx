import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GripHorizontal, X } from "lucide-react";
import { Tooltip } from "./Tooltip";

// A draggable overlay panel.
//
// Position lives in a ref-backed state here, so it survives closing and
// reopening for as long as the app is running — the user does not have to
// re-place the panel every time. It deliberately does NOT persist across
// reloads: a stale off-screen position would be worse than the safe default.
//
// Dragging is confined to the header grip. Buttons, inputs and sliders inside
// the body never start a drag, so operating the controls cannot move the panel
// out from under the cursor.

const SMALL_SCREEN = 640;
const MARGIN = 8;

export type PanelPosition = { x: number; y: number };

export function MovablePanel({
  title,
  open,
  onClose,
  defaultPosition,
  position,
  onPositionChange,
  children,
  width = 320,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  defaultPosition: PanelPosition;
  position: PanelPosition | null;
  onPositionChange: (p: PanelPosition) => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [isSmall, setIsSmall] = useState(
    () => typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN,
  );

  useEffect(() => {
    const onResize = () => setIsSmall(window.innerWidth < SMALL_SCREEN);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Keep the panel inside the viewport, so it can never be dragged out of reach. */
  const clamp = useCallback((p: PanelPosition): PanelPosition => {
    const el = ref.current;
    const w = el?.offsetWidth ?? width;
    const h = el?.offsetHeight ?? 200;
    return {
      x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
      y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
    };
  }, [width]);

  // A resize can leave the panel off-screen; pull it back in.
  useEffect(() => {
    if (!open || isSmall || !position) return;
    const onResize = () => onPositionChange(clamp(position));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, isSmall, position, clamp, onPositionChange]);

  if (!open) return null;

  const current = position ?? defaultPosition;

  // On small screens dragging is disabled entirely and the panel docks to the
  // bottom — there is not enough room for a floating window to be useful.
  const style = isSmall
    ? undefined
    : { left: current.x, top: current.y, width };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      style={style}
      className={
        isSmall
          ? "fixed inset-x-2 bottom-2 z-40 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
          : "fixed z-40 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
      }
    >
      <div
        className={`flex items-center justify-between gap-2 rounded-t-lg border-b border-slate-200 px-3 py-2 dark:border-slate-800 ${
          isSmall ? "" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={(e) => {
          if (isSmall) return;
          // Only the header background starts a drag — never a control on it.
          if ((e.target as HTMLElement).closest("button,input,select,textarea")) return;
          const rect = ref.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          onPositionChange(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
        }}
        onPointerUp={(e) => {
          drag.current = null;
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        }}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 select-none dark:text-slate-100">
          {!isSmall && <GripHorizontal className="h-4 w-4 text-slate-400" aria-hidden="true" />}
          {title}
        </span>
        <Tooltip label={`Close the ${title.toLowerCase()} panel`} placement="left">
          {(tip) => (
            <button
              {...tip}
              type="button"
              aria-label={`Close ${title}`}
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </Tooltip>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
