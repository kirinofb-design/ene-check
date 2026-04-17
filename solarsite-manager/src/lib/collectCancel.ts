import { isCollectorCancelRequested } from "@/lib/collectorLock";

export function throwIfAllCollectCancelled(userId: string): void {
  if (isCollectorCancelRequested(userId, "all")) {
    throw new Error("実行取消を受け付けたため処理を中断しました。");
  }
}

