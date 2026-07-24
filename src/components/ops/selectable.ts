import type { EntityRef } from "../../sim";

// The one shared Operations primitive: click-to-select row styling + match test
// against the store's shared `selection`. Keeps every ops table consistent
// without a speculative generic Table abstraction (CLAUDE.md Rule 2).
export function isSelected(selection: EntityRef | null, ref: EntityRef): boolean {
  return selection !== null && selection.entityType === ref.entityType && selection.entityId === ref.entityId;
}

export function rowSelectionClass(selected: boolean): string {
  return selected
    ? "bg-violet-50 ring-1 ring-inset ring-violet-300 dark:bg-violet-950/40 dark:ring-violet-700"
    : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50";
}
