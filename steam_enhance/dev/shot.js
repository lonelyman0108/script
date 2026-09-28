/*
 * 通过预览代理对商店页截图（桌面 + 移动端），用于快速检查注入效果。
 * 用法：先 npm start 启动代理，再 npm run shot -- [appid 或 sub/12467、bundle/727 这类路径] [输出目录]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const PORT = Number(process.env.PORT || 8899);
const target = process.argv[2] || "1245620";
const pagePath = /^\d+$/.test(target) ? `app/${target}` : target.replace(/^\/+|\/+$/g, "");
const outDir = process.argv[3] || path.join(__dirname, "shots");
const chrome = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  {
    name: "mobile",
    width: 390,
    height: 844,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Valve Steam App",
  },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: path.join(os.tmpdir(), "steam-enhance-shot-profile"),
    args: [`--proxy-server=127.0.0.1:${PORT}`, "--ignore-certificate-errors"],
  });
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      if (vp.ua) await page.setUserAgent(vp.ua);
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile, hasTouch: vp.mobile });
      page.on("console", (m) => /steam增强|se_/i.test(m.text()) && console.log(`[${vp.name}] ${m.text()}`));
      page.on("pageerror", (e) => console.log(`[${vp.name}] pageerror: ${e.message}`));
      // 从年龄验证页进入，顺带验证自动跳过
      await page.goto(`https://store.steampowered.com/agecheck/${pagePath}/?cc=cn&l=schinese`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector(".se_pi, .se_block", { timeout: 30000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 4000));
      await page.$$eval(".se_pi_toggle", (bs) => bs.forEach((b) => b.click())).catch(() => {});
      await new Promise((r) => setTimeout(r, 6000));
      const info = await page.evaluate(() => ({
        url: location.href,
        version: window.__steamEnhance || null,
        prices: [...document.querySelectorAll(".se_pi_low, .se_pi_extra")].map((e) => e.innerText).filter(Boolean),
        stats: document.querySelector(".se_block")?.innerText || null,
        ids: [...document.querySelectorAll(".se_id")].map((e) => e.innerText),
        rating: document.querySelector("[class*=se_rating_]")?.innerText || null,
        regions: [...document.querySelectorAll(".se_pi_regions")].map((e) => e.querySelectorAll("tr").length),
      }));
      console.log(`[${vp.name}]`, JSON.stringify(info, null, 1));
      const file = path.join(outDir, `${pagePath.replace(/\//g, "-")}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`[${vp.name}] 截图: ${file}`);
      // 关键区域特写：顶部按钮 / 购买区 / 右侧数据块 / 评测
      const parts = { dlc: "#gameAreaDLCSection", header: ".apphub_HeaderStandardTop", purchase: "#game_area_purchase", meta: ".game_meta_data", reviews: "#userReviews, #userReviews_responsive" };
      for (const [name, sel] of Object.entries(parts)) {
        const handle = await page.$(sel);
        if (!handle) continue;
        await handle.screenshot({ path: path.join(outDir, `${pagePath.replace(/\//g, "-")}-${vp.name}-${name}.png`) }).catch(() => {});
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
})();
