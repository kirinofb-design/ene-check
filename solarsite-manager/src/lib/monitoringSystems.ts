export type MonitoringSystemPreset = {
  id: string;
  label: string;
  defaultUrl: string;
};

export const MONITORING_SYSTEM_PRESETS: MonitoringSystemPreset[] = [
  {
    id: "eco-megane",
    label: "eco-megane",
    defaultUrl: "https://eco-megane.jp/",
  },
  {
    id: "fusion-solar",
    label: "Huawei FusionSolar",
    defaultUrl: "https://jp5.fusionsolar.huawei.com/",
  },
  {
    id: "sunny-portal",
    label: "SMA Sunny Portal",
    defaultUrl: "https://www.sunnyportal.com/",
  },
  {
    id: "grand-arch",
    label: "Grand Arch",
    defaultUrl: "https://grandarch.energymntr.com/",
  },
  {
    id: "solar-monitor-sf",
    label: "Solar Frontier",
    defaultUrl: "https://solar-monitor.solar-frontier.com/",
  },
  {
    id: "solar-monitor-se",
    label: "Solar Energy",
    defaultUrl: "https://solar-monitor.solar-energy.co.jp/",
  },
  {
    id: "other",
    label: "その他（手入力）",
    defaultUrl: "",
  },
];

export function resolvePreset(system: string | null | undefined): MonitoringSystemPreset | null {
  if (!system) return null;
  const hit = MONITORING_SYSTEM_PRESETS.find((p) => p.id === system);
  return hit ?? null;
}

