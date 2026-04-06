// SMA Sunny Portal 内部APIプローブ（Cookie指定で叩く）
//
// 目的:
// - DevTools(Network)で見つけた内部API候補を、このスクリプトで検証しやすくする
// - endpoint が見つからない/判別できない場合の切り分け
//
// 実行例:
//   set SUNNY_ASPNET_SESSION_ID=...
//   set SUNNY_BIGIP_SERVER_POOL=...
//   npm run <ts-node 実行方法>
//
// 環境:
// - Node 18+（fetch が利用可能）を想定

type ProbeResult = {
  url: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  bodySnippet: string;
};

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function probe(url: string, cookieHeader: string, userAgent: string): Promise<ProbeResult> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
      "User-Agent": userAgent,
      Accept: "*/*",
    },
  });

  const contentType = resp.headers.get("content-type") ?? "";
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const text = await resp.text();
  return {
    url: resp.url,
    status: resp.status,
    contentType,
    headers,
    bodySnippet: text.slice(0, 2000),
  };
}

async function main() {
  const ASPNET = process.env.SUNNY_ASPNET_SESSION_ID;
  const BIGIP = process.env.SUNNY_BIGIP_SERVER_POOL;

  if (!ASPNET || !BIGIP) {
    console.error(
      "SUNNY_ASPNET_SESSION_ID と SUNNY_BIGIP_SERVER_POOL を設定してください。プローブは Cookieなしでは成功しない可能性があります。",
    );
  }

  const cookieHeader = ASPNET && BIGIP ? `ASP.NET_SessionId=${ASPNET}; BIGipServerPool_P_SunnyPortal=${BIGIP}` : "";
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

  // 試すエンドポイント一覧（最初の当たりを探す）
  const endpoints = [
    "https://www.sunnyportal.com/homemanager",
    "https://www.sunnyportal.com/Plants",
    "https://www.sunnyportal.com/api/plant",
    "https://www.sunnyportal.com/CustomerPlants",
  ];

  // TODO: DevTools で発見した URL 候補をここに追記してください（例）
  // - 日別発電（plantIdベース）:
  //   https://www.sunnyportal.com/api/plant/{{plantId}}/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
  //   https://www.sunnyportal.com/api/plant/daily?plantId={{plantId}}&from=YYYY-MM-DD&to=YYYY-MM-DD
  // - 月別やレポート系:
  //   https://www.sunnyportal.com/api/plant/report?plantId={{plantId}}&period=YYYY-MM

  for (const url of endpoints) {
    console.log(`\n--- probe: ${url} ---`);
    if (!cookieHeader) {
      console.log("(cookieHeader is empty; set env vars to enable)");
      continue;
    }
    try {
      const r = await probe(url, cookieHeader, userAgent);
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error(String(e));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

