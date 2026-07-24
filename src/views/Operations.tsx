import type { ViewProps } from "./registry";
import { useOpsStore } from "../store/opsStore";
import { OpsHeader } from "./operations/OpsHeader";
import { OpsTabBar } from "./operations/OpsTabBar";
import { BerthPlanningTab } from "./operations/BerthPlanningTab";
import { YardControlTab } from "./operations/YardControlTab";
import { AnchorageTab } from "./operations/AnchorageTab";
import { CargoRiskTab } from "./operations/CargoRiskTab";
import { SafetyStockTab } from "./operations/SafetyStockTab";

// Operations shell: shared controls + five operational workspaces. Only the
// active tab renders; tab/search/horizon live in opsStore so they survive a
// Digital Twin round-trip (views unmount on sidebar navigation).
export function Operations({ onNavigate }: ViewProps) {
  const tab = useOpsStore((s) => s.tab);
  return (
    <div className="mx-auto max-w-7xl space-y-4 2xl:max-w-none">
      <OpsHeader onNavigate={onNavigate} />
      <OpsTabBar />
      {tab === "berths" && <BerthPlanningTab />}
      {tab === "yard" && <YardControlTab />}
      {tab === "anchorage" && <AnchorageTab onNavigate={onNavigate} />}
      {tab === "cargo" && <CargoRiskTab />}
      {tab === "safety" && <SafetyStockTab />}
    </div>
  );
}
