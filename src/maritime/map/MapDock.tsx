import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

// MDS: the map's own control dock — the panels that used to take a fixed 20rem
// column now float over the bottom-left corner of the map, so the chart itself
// gets the whole width.
//
// One panel is open at a time. The trigger chips stay visible at the bottom and
// the panel opens UPWARD from them, which is how the legend already behaved —
// this generalises that pattern rather than inventing a second one.
//
// Everything here is presentation. The dock takes rendered content and never
// reads simulation state, so it cannot disagree with the panels it hosts.

/**
 * The "liquid glass" surface: a translucent, saturated blur over the map with a
 * bright hairline edge and a specular top sheen.
 *
 * It is deliberately DARK glass and carries the `dark` class, in both app
 * themes. The map underneath is always dark (deep-water vector fill, or
 * satellite imagery under a dark wash), so light glass would leave the panels
 * unreadable in light mode. `dark` is a real Tailwind variant here
 * (tailwind.config darkMode: "class"), so the hosted panels — which are already
 * fully dark-mode styled — resolve their `dark:` colours and stay legible
 * without any of them being touched.
 */
export const GLASS =
  "dark rounded-2xl border border-white/15 bg-slate-900/55 shadow-2xl shadow-black/50 backdrop-blur-2xl backdrop-saturate-150";

/** The specular sheen. Purely decorative, never intercepts pointer events. */
export function GlassSheen() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.14] via-transparent to-white/[0.06] ring-1 ring-inset ring-white/10"
    />
  );
}

export type DockItem = {
  id: string;
  label: string;
  icon: ReactNode;
  /** Small count/name shown on the chip, e.g. the selected vessel's name. */
  badge?: string;
  /** Rendered only while this item is the open one. */
  content: ReactNode;
  /** Chip is shown but not clickable (nothing selected yet). */
  disabled?: boolean;
  /** Panel width; defaults to a comfortable reading measure. */
  width?: string;
};

export function MapDock({
  items,
  open,
  onOpenChange,
}: {
  items: DockItem[];
  open: string | null;
  onOpenChange: (id: string | null) => void;
}) {
  const active = items.find((i) => i.id === open) ?? null;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col gap-2">
      {active && (
        <div
          className={`pointer-events-auto relative ${active.width ?? "w-[24rem]"} max-w-full ${GLASS}`}
        >
          <GlassSheen />
          {/* max-h keeps a long vessel card (route comparison + recommendation)
              from covering the map it is describing. */}
          <div className="glass-scroll relative max-h-[60vh] overflow-y-auto overscroll-contain p-3 text-slate-100">
            {active.content}
          </div>
        </div>
      )}

      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
        {items.map((item) => {
          const isOpen = item.id === open;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              aria-expanded={isOpen}
              onClick={() => onOpenChange(isOpen ? null : item.id)}
              className={`relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur-xl backdrop-saturate-150 transition-colors disabled:cursor-default disabled:opacity-40 ${
                isOpen
                  ? "border-white/25 bg-white/20 text-white"
                  : "border-white/15 bg-slate-900/55 text-slate-200 hover:bg-slate-800/60 disabled:hover:bg-slate-900/55"
              }`}
            >
              {item.icon}
              {item.label}
              {item.badge && (
                <span className="max-w-[8rem] truncate text-[11px] font-normal text-slate-300">
                  {item.badge}
                </span>
              )}
              {!item.disabled &&
                (isOpen ? (
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
