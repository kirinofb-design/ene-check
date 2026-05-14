/**
 * 全データ一括取得の「システム別ファンアウト」用のサーバー間認証。
 * CRON_SECRET と共用すると Cron 用の値を増やしたくない場合に COLLECT_FANOUT_SECRET を使う。
 */
export function getCollectFanoutSecret(): string {
  return (process.env.COLLECT_FANOUT_SECRET ?? process.env.CRON_SECRET ?? "").trim();
}
