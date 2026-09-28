/*
 * 社区页效果检查：个人资料、个人成就、库存（选中第一个可交易物品）。
 * 用法：先 npm start，再 npm run shot:community -- [个人资料路径，如 id/ChetFaliszek] [成就游戏，如 TF2]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer-core");

const PORT = Number(process.env.PORT || 8899);
const profile = (process.argv[2] || "id/ChetFaliszek").replace(/^\/+|\/+$/g, "");
const game = process.argv[3] || "TF2";
const outDir = path.join(__dirname, "shots");
const chrome = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && fs.existsSync(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    userDataDir: path.join(os.tmpdir(), "steam-enhance-shot-profile"),
    args: [`--proxy-server=127.0.0.1:${PORT}`, "--ignore-certificate-errors"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));
  const base = `https://steamcommunity.com/${profile}`;
  try {
    await page.goto(`${base}/?l=schinese`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(3000);
    console.log("[资料]", await page.evaluate(() => [...document.querySelectorAll(".profile_item_links .profile_count_link")].slice(-2).map((e) => e.innerText.replace(/\s+/g, " ")).join(" | ")));
    const links = await page.$(".profile_item_links");
    if (links) await links.screenshot({ path: path.join(outDir, "community-profile.png") });

    await page.goto(`${base}/stats/${game}/?tab=achievements&l=schinese`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(6000);
    console.log("[成就]", await page.evaluate(() => {
      const bar = document.querySelector(".se_ach_bar");
      const first = [...document.querySelectorAll(".se_ach_pct")].slice(0, 3).map((e) => e.closest(".achieveTxtHolder").querySelector("h3").innerText + " " + e.innerText);
      return `${bar ? bar.innerText : "无统计条"} | ${first.join(" | ")}`;
    }));
    await page.click(".se_ach_bar button").catch(() => {});
    await wait(500);
    console.log("[成就排序后前 3]", await page.evaluate(() => [...document.querySelectorAll(".achieveTxtHolder")].slice(0, 3).map((h) => h.querySelector("h3").innerText + " " + ((h.querySelector(".se_ach_pct") || {}).innerText || "")).join(" | ")));
    await page.screenshot({ path: path.join(outDir, "community-achievements.png") });

    await page.goto(`${base}/inventory/?l=schinese`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(8000);
    const item = await page.$(".inventory_page:not([style*='none']) .item.app730, .inventory_page:not([style*='none']) .item");
    if (item) {
      await item.click();
      await wait(5000);
      console.log("[库存]", await page.evaluate(() => [...document.querySelectorAll(".se_market")].map((e) => e.innerText.replace(/\s+/g, " ")).join(" | ") || "未显示市场信息"));
      await page.screenshot({ path: path.join(outDir, "community-inventory.png") });
    } else {
      console.log("[库存] 没有可点击的物品（库存可能不公开）");
    }
  } finally {
    await browser.close();
  }
})();
