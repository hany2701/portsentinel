import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

// Contains any render/WebGL crash inside the twin so the rest of the dashboard is
// unaffected (D-01, IP-5 gate). Retry remounts the subtree with a fresh key.
type Props = { children: ReactNode; onRetry?: () => void };
type State = { error: Error | null };

export class TwinErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Digital twin crashed (contained by error boundary):", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-[#d03b3b]/40 bg-[#d03b3b]/5 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-[#d03b3b]" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">The 3D view failed to render.</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              The rest of the dashboard is unaffected. {this.state.error.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { this.props.onRetry?.(); this.setState({ error: null }); }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
