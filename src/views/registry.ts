import type { ComponentType } from "react";
import {
  Activity,
  Bell,
  Boxes,
  CloudSun,
  Globe2,
  Ship,
  type LucideIcon,
} from "lucide-react";
import { ResilienceMonitor } from "./ResilienceMonitor";
import { MaritimeNetwork } from "./MaritimeNetwork";
import { DigitalTwin } from "./DigitalTwin";
import { Operations } from "./Operations";
import { Weather } from "./Weather";
import { Alerts } from "./Alerts";

export type ViewId = "monitor" | "maritime" | "twin" | "operations" | "weather" | "alerts";

export type ViewProps = { onNavigate: (view: ViewId) => void };

export type ViewDef = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  component: ComponentType<ViewProps>;
};

export const VIEWS: ViewDef[] = [
  { id: "monitor", label: "Resilience Monitor", icon: Activity, component: ResilienceMonitor },
  // GR-4 (approved nav amendment): one entry carrying the global⇄regional zoom
  // continuum, sitting immediately above the Tuas twin it drills down into.
  { id: "maritime", label: "Maritime Network", icon: Globe2, component: MaritimeNetwork },
  { id: "twin", label: "Digital Twin", icon: Boxes, component: DigitalTwin },
  { id: "operations", label: "Operations", icon: Ship, component: Operations },
  { id: "weather", label: "Weather", icon: CloudSun, component: Weather },
  { id: "alerts", label: "Alerts", icon: Bell, component: Alerts },
];
