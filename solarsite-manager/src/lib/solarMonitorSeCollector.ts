import { runSolarMonitorCollector } from "@/lib/solarMonitorCollector";

export async function runSolarMonitorSeCollector(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ recordCount: number; errorCount: number }> {
  return runSolarMonitorCollector(userId, startDate, endDate, "solar-monitor-se");
}
