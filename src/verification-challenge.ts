/**
 * Recognise a site's human-verification step (slider, login wall, risk
 * page) on the shopping sites whose bot checks always reject the automated
 * TongPing browser. The Worker then hands the page to a normal local Chrome so
 * the user can pass it herself; nothing here tries to solve anything.
 */

const CHALLENGE_SITES = /(^|\.)(taobao\.com|tmall\.com|goofish\.com|1688\.com|alipay\.com|jd\.com|bilibili\.com|google\.com|youtube\.com)$/i;

/** URL-only signals: pages that are a verification or login wall as a whole. */
export function challengeFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!CHALLENGE_SITES.test(url.hostname)) return null;
  const host = url.hostname.toLowerCase();
  const pathAndQuery = (url.pathname + url.search).toLowerCase();
  if (pathAndQuery.includes("_____tmd_____") || pathAndQuery.includes("/punish")) return "slider";
  if (host === "cfe.m.jd.com" && pathAndQuery.includes("risk_handler")) return "risk-check";
  if (
    host === "login.taobao.com" ||
    host === "login.tmall.com" ||
    host === "passport.goofish.com" ||
    host === "passport.jd.com" ||
    host === "passport.bilibili.com" ||
    // Google refuses sign-in from automated browsers outright.
    (host === "accounts.google.com" && /\/(signin|servicelogin|v3\/signin)/.test(pathAndQuery))
  ) {
    return "login";
  }
  return null;
}

/** Page-side probe (runs in the page): a slider dialog over a normal page. */
export const CHALLENGE_DOM_PROBE = `(() => {
  const selectors = [
    "#nc_1_n1z", "#nc_1_wrapper", ".nc_wrapper", ".nc-container",
    "#baxia-dialog-content", "iframe[src*='punish']", "iframe[src*='_____tmd_____']",
    // Geetest, used by Bilibili and others.
    ".geetest_panel_box", ".geetest_box", ".geetest_widget",
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.getClientRects().length > 0) return "slider";
  }
  // The mini login window Taobao lays over a page for signed-out visitors.
  const loginFrame = document.querySelector("iframe[src*='login.taobao.com'], iframe[src*='login.tmall.com'], iframe[src*='passport.goofish.com']");
  if (loginFrame && loginFrame.getClientRects().length > 0) return "login";
  const text = (document.body && document.body.innerText || "").slice(0, 4000);
  if (/请拖动下方滑块完成验证|请按住滑块，拖动到最右边|拖动滑块完成验证/.test(text)) return "slider";
  // YouTube's "Sign in to confirm you're not a bot" wall.
  if (/Sign in to confirm you.re not a bot|登录以确认你不是机器人|登录以确认您不是机器人/.test(text)) return "login";
  return null;
})()`;

export function isChallengeSite(raw: string): boolean {
  try {
    return CHALLENGE_SITES.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}
