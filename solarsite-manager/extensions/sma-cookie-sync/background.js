const SUNNY_PORTAL_HOST = "www.sunnyportal.com";
const SUNNY_PORTAL_URL = "https://www.sunnyportal.com/";
const API_URL = "http://localhost:3000/api/sma-cookie";

async function syncSunnyPortalFormsLoginCookie() {
  try {
    let cookie = await chrome.cookies.get({
      url: SUNNY_PORTAL_URL,
      name: ".SunnyPortalFormsLogin",
    });

    // 環境差分で先頭ドットなしの可能性もあるためフォールバック
    if (!cookie) {
      cookie = await chrome.cookies.get({
        url: SUNNY_PORTAL_URL,
        name: "SunnyPortalFormsLogin",
      });
    }

    if (!cookie || !cookie.value) {
      console.log("[SMA Cookie Sync] .SunnyPortalFormsLogin not found");
      return;
    }

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ formsLogin: cookie.value }),
    });

    const bodyText = await response.text();
    if (response.ok) {
      console.log("[SMA Cookie Sync] Cookie sync success", {
        status: response.status,
        bodyHead: bodyText.substring(0, 200),
      });
    } else {
      console.error("[SMA Cookie Sync] Cookie sync failed", {
        status: response.status,
        bodyHead: bodyText.substring(0, 200),
      });
    }
  } catch (error) {
    console.error("[SMA Cookie Sync] Unexpected error", error);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;

  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch {
    return;
  }
  if (host !== SUNNY_PORTAL_HOST) return;

  void syncSunnyPortalFormsLoginCookie();
});
