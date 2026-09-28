/*
 * 生成 README 用的截图（JPEG，输出到 ../images/）。
 * 用法：先启动预览代理（如需近期史低：ARG_HISTORY=true ARG_ITAD_KEY=xxx npm start），再 npm run shot:readme
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const PORT = Number(process.env.PORT || 8899);
const outDir = path.join(__dirname, "..", "images");
const chrome = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Valve Steam App";

async function shot(page, selector, name, clickRegions, padBottom = 0) {
  const h = await page.$(selector);
  if (!h) return console.log(`跳过 ${name}：找不到 ${selector}`);
  if (clickRegions) {
    await page.$$eval(".se_pi_toggle", (bs) => bs[0] && bs[0].click());
    await wait(6000);
  }
  // 购买按钮是绝对定位、伸出购买块底部的，需要额外留出底部空间；用文档坐标裁剪
  const box = await h.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  });
  await page.screenshot({
    path: path.join(outDir, `${name}.jpg`),
    type: "jpeg",
    quality: 80,
    captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height + padBottom },
  });
  console.log(`已生成 images/${name}.jpg`);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: path.join(os.tmpdir(), "steam-enhance-readme-profile"),
    args: [`--proxy-server=127.0.0.1:${PORT}`, "--ignore-certificate-errors"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto("https://store.steampowered.com/agecheck/app/1245620/?cc=cn&l=schinese", { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(12000);
    await shot(page, "#game_area_purchase .game_area_purchase_game", "purchase", true, 30);
    await shot(page, "#gameAreaDLCSection", "dlc");
    await shot(page, ".se_block", "stats");

    const mobile = await browser.newPage();
    await mobile.setUserAgent(MOBILE_UA);
    await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await mobile.goto("https://store.steampowered.com/app/1245620/?cc=cn&l=schinese", { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(12000);
    await shot(mobile, "#game_area_purchase .game_area_purchase_game", "mobile-purchase", false, 10);

    await page.goto("https://steamcommunity.com/id/erikjohnson/stats/TF2/?tab=achievements&l=schinese", { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(6000);
    await page.click(".se_ach_bar button").catch(() => {});
    await wait(800);
    await page.evaluate(() => document.querySelector(".se_ach_bar").scrollIntoView());
    await page.screenshot({ path: path.join(outDir, "achievements.jpg"), type: "jpeg", quality: 80 });
    console.log("已生成 images/achievements.jpg");
  } finally {
    await browser.close();
  }
})();
