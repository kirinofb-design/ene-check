export type MonitoringSystemAuthTarget = {
  systemId:
    | "eco-megane"
    | "fusion-solar"
    | "sunny-portal"
    | "grand-arch"
    | "solar-monitor-sf"
    | "solar-monitor-se";
  label: string;
  url: string;
};

export const MONITORING_AUTH_TARGETS: MonitoringSystemAuthTarget[] = [
  {
    systemId: "eco-megane",
    label: "エコめがね",
    url: "https://eco-megane.jp/login",
  },
  {
    systemId: "fusion-solar",
    label: "Huawei FusionSolar",
    url: "https://jp5.fusionsolar.huawei.com",
  },
  {
    systemId: "sunny-portal",
    label: "SMA Sunny Portal",
    url: "https://www.sunnyportal.com/Plants",
  },
  {
    systemId: "grand-arch",
    label: "ラプラスシステム（Grand Arch）",
    url: "https://grandarch.energymntr.com/",
  },
  {
    systemId: "solar-monitor-sf",
    label: "Solar Monitor（池新田・本社）",
    url: "https://solar-monitor.solar-frontier.com",
  },
  {
    systemId: "solar-monitor-se",
    label: "Solar Monitor（須山）",
    url: "https://solar-monitor.solar-energy.co.jp",
  },
];

