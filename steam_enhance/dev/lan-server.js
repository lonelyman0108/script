/*
 * 局域网测试服务：手机与电脑同一 Wi-Fi 时，Surge 可直接从本机安装模块，不经过 GitHub / iCloud。
 * 每次请求都实时读取仓库里的最新模块与脚本，改完代码后在 Surge 里“更新模块”即可。
 * 用法：npm run lan            → 自动选取局域网 IP，端口 8900
 *       HOST=192.168.x.x PORT=8900 npm run lan
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8900);
const HOST = process.env.HOST || pickLanIp();
const BASE = `http://${HOST}:${PORT}`;

function pickLanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal && /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(i.address)) return i.address;
    }
  }
  return "127.0.0.1";
}

function buildModule() {
  // 脚本地址带上文件修改时间，脚本变化后 Surge 更新模块时会重新下载
  const mtime = Math.floor(fs.statSync(path.join(ROOT, "scripts", "steam_enhance.js")).mtimeMs);
  return fs
    .readFileSync(path.join(ROOT, "surge", "steam_enhance.sgmodule"), "utf8")
    .replace(/^#!name=(.*)$/m, "#!name=$1（局域网测试）")
    .replace(/script-path=[^,\s]+/g, `script-path=${BASE}/steam_enhance.js?v=${mtime}`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  const from = req.socket.remoteAddress;
  let body = null;
  let type = "text/plain; charset=utf-8";
  if (url.pathname === "/steam_enhance.sgmodule") {
    body = buildModule();
  } else if (url.pathname === "/steam_enhance.js") {
    body = fs.readFileSync(path.join(ROOT, "scripts", "steam_enhance.js"), "utf8");
    type = "application/javascript; charset=utf-8";
  }
  console.log(`${new Date().toLocaleTimeString()} ${from} ${req.method} ${req.url} -> ${body == null ? 404 : 200}`);
  if (body == null) {
    res.writeHead(404, { "Content-Type": type });
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`局域网测试服务已启动，在 Surge 中从 URL 安装模块：\n  ${BASE}/steam_enhance.sgmodule`);
});
