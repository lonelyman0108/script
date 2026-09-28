/*
 * Steam 商店增强 本地预览代理：解析 ../surge/steam_enhance.sgmodule 的 [Script] 段，
 * 用 MITM 代理 + Node vm 模拟 Surge 脚本运行环境（$request / $response / $httpClient / $persistentStore / $done），
 * script-path 自动替换为本地 ../scripts 下的同名文件，改完脚本刷新页面即生效。
 *
 * 用法：npm start            → 启动代理（默认 8899）
 *       npm start -- --chrome → 同时启动一个走代理的独立 Chrome 窗口
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const vm = require("vm");
const { spawn } = require("child_process");
const { Proxy } = require("http-mitm-proxy");

const PORT = Number(process.env.PORT || 8899);
const ROOT = path.resolve(__dirname, "..");
const MODULE_FILE = path.join(ROOT, "surge", "steam_enhance.sgmodule");
const STORE_FILE = path.join(__dirname, ".persistent-store.json");
const CA_DIR = path.join(__dirname, ".ca");

// ---------- 解析模块 ----------
function loadModule() {
  const text = fs.readFileSync(MODULE_FILE, "utf8");
  const hosts = [];
  const args = {};
  const scripts = [];
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // #!arguments 默认值，可用环境变量 ARG_<名称> 覆盖（如 ARG_ITAD_KEY=xxx）
    const argLine = line.match(/^#!arguments=(.*)$/);
    if (argLine) {
      argLine[1].split(",").forEach((kv) => {
        const i = kv.indexOf(":");
        const k = kv.slice(0, i).trim();
        args[k] = process.env[`ARG_${k}`] != null ? process.env[`ARG_${k}`] : kv.slice(i + 1).trim();
      });
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section === "MITM" && line.startsWith("hostname")) {
      line
        .split("=")[1]
        .split(",")
        .map((h) => h.trim())
        .filter((h) => h && h !== "%APPEND%")
        .forEach((h) => hosts.push(h.replace("%APPEND% ", "")));
    }
    if (section === "Script") {
      const eq = line.indexOf("=");
      const name = line.slice(0, eq).trim();
      const opts = {};
      line
        .slice(eq + 1)
        .split(",")
        .forEach((kv) => {
          const i = kv.indexOf("=");
          opts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
        });
      scripts.push({
        name,
        type: opts.type,
        pattern: new RegExp(opts.pattern),
        requiresBody: opts["requires-body"] === "1" || opts["requires-body"] === "true",
        file: path.join(ROOT, "scripts", path.basename(opts["script-path"])),
        argument: (opts.argument || "").replace(/^"|"$/g, "").replace(/\{\{\{([^}]+)\}\}\}/g, (m, k) => encodeURIComponent(args[k] != null ? args[k] : "")),
      });
    }
  }
  return { hosts, scripts };
}

// ---------- Surge 运行时模拟 ----------
function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function runScript(script, ctx) {
  return new Promise((resolve) => {
    let finished = false;
    let watchdog = null;
    const done = (v) => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      resolve(v || {});
    };
    const client = (method) => (opts, cb) => {
      const o = typeof opts === "string" ? { url: opts } : opts;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), (o.timeout || 5) * 1000);
      fetch(o.url, { method, headers: o.headers, body: o.body, signal: ctrl.signal })
        .then(async (r) => {
          const headers = {};
          r.headers.forEach((v, k) => (headers[k] = v));
          cb(null, { status: r.status, headers }, await r.text());
        })
        .catch((e) => cb(String(e.message || e)))
        .finally(() => clearTimeout(timer));
    };
    const sandbox = Object.assign(
      {
        console: { log: (...a) => console.log(`  [${script.name}]`, ...a) },
        setTimeout,
        clearTimeout,
        $environment: { "surge-version": "dev-proxy" },
        $persistentStore: {
          read: (k) => readStore()[k] ?? null,
          write: (v, k) => {
            const s = readStore();
            s[k] = v;
            fs.writeFileSync(STORE_FILE, JSON.stringify(s));
            return true;
          },
        },
        $httpClient: { get: client("GET"), post: client("POST") },
        $done: done,
      },
      ctx
    );
    watchdog = setTimeout(() => {
      console.warn(`  [${script.name}] 超时未 $done`);
      done({});
    }, 20000);
    try {
      // 每次重新读取，改脚本无需重启
      vm.runInNewContext(fs.readFileSync(script.file, "utf8"), sandbox, { filename: script.file });
    } catch (e) {
      console.error(`  [${script.name}] 脚本异常`, e);
      done({});
    }
  });
}

// ---------- 代理 ----------
const { hosts } = loadModule();
const proxy = new Proxy();

proxy.onError((ctx, err) => {
  if (err && err.code !== "ECONNRESET") console.error("proxy error:", err.message);
});

proxy.onRequest((ctx, callback) => {
  const req = ctx.clientToProxyRequest;
  const url = `${ctx.isSSL ? "https" : "http"}://${req.headers.host}${req.url}`;
  const { scripts } = loadModule();
  const request = { url, method: req.method, headers: req.headers };

  const reqScript = scripts.find((s) => s.type === "http-request" && s.pattern.test(url));
  if (reqScript) {
    runScript(reqScript, { $request: request, $argument: reqScript.argument }).then((r) => {
      if (r.response) {
        console.log(`[req] ${reqScript.name} ${url} -> ${r.response.status}`);
        ctx.proxyToClientResponse.writeHead(r.response.status || 200, r.response.headers || {});
        ctx.proxyToClientResponse.end(r.response.body || "");
      } else {
        callback();
      }
    });
    return;
  }

  const resScript = scripts.find((s) => s.type === "http-response" && s.requiresBody && s.pattern.test(url));
  if (!resScript) return callback();

  // 要求上游不压缩，便于脚本直接处理文本
  ctx.proxyToServerRequestOptions.headers["accept-encoding"] = "identity";
  const chunks = [];
  ctx.onResponse((ctx, cb) => {
    delete ctx.serverToProxyResponse.headers["content-length"];
    // 推迟写响应头，等脚本返回后再用脚本修改过的 headers（与 Surge 行为一致）
    const res = ctx.proxyToClientResponse;
    const realWriteHead = res.writeHead.bind(res);
    res.writeHead = (status, headers) => {
      res.__deferred = { realWriteHead, status, headers };
      return res;
    };
    cb();
  });
  ctx.onResponseData((ctx, chunk, cb) => {
    chunks.push(chunk);
    cb(null, undefined);
  });
  ctx.onResponseEnd((ctx, cb) => {
    const res = ctx.serverToProxyResponse;
    const body = Buffer.concat(chunks).toString("utf8");
    runScript(resScript, {
      $request: request,
      $argument: resScript.argument,
      $response: { status: res.statusCode, headers: res.headers, body },
    }).then((r) => {
      console.log(`[res] ${resScript.name} ${url} ${r.body ? "已修改" : "未修改"}${r.headers ? "（含响应头）" : ""}`);
      const out = ctx.proxyToClientResponse;
      const d = out.__deferred;
      if (d) {
        const headers = Object.assign({}, r.headers || d.headers);
        Object.keys(headers).forEach((k) => /^content-length$/i.test(k) && delete headers[k]);
        d.realWriteHead(d.status, headers);
      }
      out.write(r.body != null ? r.body : body);
      cb();
    });
  });
  callback();
});

proxy.listen({ port: PORT, sslCaDir: CA_DIR, host: "127.0.0.1" }, () => {
  console.log(`Steam 商店增强 预览代理已启动: http://127.0.0.1:${PORT}`);
  console.log(`MITM 主机: ${hosts.join(", ")}`);
  if (process.argv.includes("--chrome")) launchChrome();
});

// ---------- 启动独立 Chrome（仅 MITM 主机走代理，独立配置目录，不影响日常浏览器） ----------
function launchChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const chrome = candidates.find((p) => fs.existsSync(p));
  if (!chrome) return console.warn("未找到 Chrome，请设置 CHROME_PATH");

  const pac = `function FindProxyForURL(url, host) { var h = ${JSON.stringify(hosts)}; for (var i = 0; i < h.length; i++) if (host === h[i]) return "PROXY 127.0.0.1:${PORT}"; return "DIRECT"; }`;
  const profile = path.join(os.tmpdir(), "steam-enhance-chrome-profile");
  const startUrl = process.env.START_URL || "https://store.steampowered.com/app/1245620/";
  spawn(
    chrome,
    [
      `--user-data-dir=${profile}`,
      `--proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac).toString("base64")}`,
      "--ignore-certificate-errors",
      "--no-first-run",
      "--no-default-browser-check",
      startUrl,
    ],
    { detached: true, stdio: "ignore" }
  ).unref();
  console.log(`已启动独立 Chrome（配置目录 ${profile}）: ${startUrl}`);
}
