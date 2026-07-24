import { X } from "lucide-react";
import { useSimStore } from "../store/simStore";
import { showToast } from "./ToastStack";

// D-77: an approved safety-stock advisory produces a visible artifact — the
// customer notice — instead of dead-ending in the queue.
export function NoticeModal() {
  const notice = useSimStore((s) => s.customerNotice);
  const dismiss = useSimStore((s) => s.dismissNotice);
  if (!notice) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(notice);
      showToast("Notice copied to clipboard.", "success");
    } catch {
      showToast("Copy failed — use the download instead.", "error");
    }
  };
  const download = () => {
    const blob = new Blob([notice], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customer-advisory.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Customer advisory notice</h2>
          <button type="button" aria-label="Close notice" onClick={dismiss} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">{notice}</pre>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={copy} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">Copy</button>
          <button type="button" onClick={download} className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900">Download</button>
        </div>
      </div>
    </div>
  );
}
