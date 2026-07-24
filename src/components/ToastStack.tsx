import { useEffect, useState } from "react";

export type Toast = {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
};

let toasts: Toast[] = [];
let listeners: Array<(next: Toast[]) => void> = [];
let nextId = 1;

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function showToast(message: string, tone: Toast["tone"] = "info") {
  const toast: Toast = { id: nextId++, message, tone };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== toast.id);
    emit();
  }, 4000);
}

const TONE_DOT: Record<Toast["tone"], string> = {
  info: "bg-[#2a78d6] dark:bg-[#3987e5]",
  success: "bg-[#1baf7a] dark:bg-[#199e70]",
  error: "bg-[#d03b3b]",
};

export function ToastStack() {
  const [items, setItems] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.push(setItems);
    return () => {
      listeners = listeners.filter((l) => l !== setItems);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[t.tone]}`}
            aria-hidden="true"
          />
          {t.message}
        </div>
      ))}
    </div>
  );
}
