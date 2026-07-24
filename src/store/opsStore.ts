import { create } from "zustand";
import { FORECAST_HORIZON_OPTIONS } from "../sim";

// Operations-shell UI state (tab, search, horizon). Lives in a store rather than
// component state because views unmount on sidebar navigation and these should
// survive a Digital Twin round-trip. Deliberately NOT persisted (persistence.ts
// stays engine+chat only) and never touches sim state — determinism unaffected.
export type OpsTab = "berths" | "yard" | "anchorage" | "cargo" | "safety";

type OpsStore = {
  tab: OpsTab;
  search: string;
  horizonTicks: number;
  setTab: (tab: OpsTab) => void;
  setSearch: (search: string) => void;
  setHorizon: (ticks: number) => void;
};

export const useOpsStore = create<OpsStore>((set) => ({
  tab: "berths",
  search: "",
  horizonTicks: FORECAST_HORIZON_OPTIONS[1],
  setTab: (tab) => set({ tab }),
  setSearch: (search) => set({ search }),
  setHorizon: (horizonTicks) => set({ horizonTicks }),
}));
