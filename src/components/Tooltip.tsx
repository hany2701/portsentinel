import { useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A tooltip that appears on BOTH hover and keyboard focus.
//
// The native `title` attribute only surfaces on hover, so a keyboard user never
// learns what an icon-only button does. This wraps the trigger, shows the label
// on pointer-enter and focus, and hides it on leave, blur or Escape. The text is
// wired through aria-describedby so a screen reader announces it too — the
// button keeps its own aria-label as the accessible NAME, and this is the
// supporting description.

// Gap between the trigger and the tooltip, so it never covers its own trigger.
const OFFSET = 8;

function placeAt(placement: string, r: DOMRect): CSSProperties {
  switch (placement) {
    case "top":
      return { left: r.left + r.width / 2, top: r.top - OFFSET, transform: "translate(-50%, -100%)" };
    case "left":
      return { left: r.left - OFFSET, top: r.top + r.height / 2, transform: "translate(-100%, -50%)" };
    case "right":
      return { left: r.right + OFFSET, top: r.top + r.height / 2, transform: "translate(0, -50%)" };
    default:
      return { left: r.left + r.width / 2, top: r.bottom + OFFSET, transform: "translate(-50%, 0)" };
  }
}

export function Tooltip({
  label,
  children,
  placement = "bottom",
}: {
  label: string;
  children: (props: { "aria-describedby": string }) => ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
}) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  // The trigger's viewport rect, captured when the tooltip opens. `null` = closed.
  const [rect, setRect] = useState<DOMRect | null>(null);

  const show = () => {
    const el = trigger.current;
    if (el) setRect(el.getBoundingClientRect());
  };

  return (
    <span
      ref={trigger}
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={() => setRect(null)}
      onFocusCapture={show}
      onBlurCapture={() => setRect(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setRect(null);
      }}
    >
      {children({ "aria-describedby": id })}
      {/* Portalled to <body> and positioned `fixed`, NOT absolutely inside the
          trigger. An absolute `whitespace-nowrap` tooltip is still part of its
          ancestors' scrollable overflow, so opening one on a right-edge or
          bottom-edge control (the header's simulation and chat buttons, the map's
          zoom stack) grew the document and flashed a scrollbar in and out as the
          pointer crossed between them — the page appeared to shake. Fixed
          elements contribute no scrollable overflow, so hovering can no longer
          move the layout. Mounted only while shown; focus opens it before a
          screen reader reads the description, so aria-describedby still resolves
          when it matters. */}
      {rect &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={placeAt(placement, rect)}
            className="pointer-events-none fixed z-[60] whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-slate-700"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
