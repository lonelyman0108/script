/*
 * @file steam_enhance.js
 * @description Steam 商店增强：参考 SteamDB / Augmented Steam 浏览器扩展，在商店页注入原生风格的增强信息。
 *   - http-response：向 store.steampowered.com 的 HTML 内联前端脚本（CSP 允许 'unsafe-inline'，不改 CSP）
 *   - http-request ：拦截同源伪路径 /__steam_enhance/api/*，由代理端请求上游、缓存后返回（绕开 CSP connect-src 与 CORS）
 * 数据来源：Steam 官方 API（在线人数、各区价格）、Augmented Steam（史低、峰值、HLTB、媒体评分、汇率）、IsThereAnyDeal（近期史低）。
 * Augmented Steam 服务端要求客户端同时支持 P-256 与 P-384 曲线，Surge 的 $httpClient 握手失败（SSLV3_ALERT_HANDSHAKE_FAILURE），
 * 因此由页面（WebKit / Chromium）直接请求，注入时把该域名加入 CSP connect-src；其余请求仍走代理端。
 * 不请求 steamdb.info（SteamDB 禁止抓取），仅提供跳转链接。
 * @author lonelyman0108
 */

const VERSION = "0.7.0";
const ROUTE_PREFIX = "/__steam_enhance/";
const INJECT_MARK = "<!--steam-enhance-injected-->";
const CACHE_KEY = "steam_enhance_cache";
const CACHE_MAX_ENTRIES = 300;
const TTL = {
  players: 10 * 60 * 1000,
  history: 6 * 60 * 60 * 1000,
  regions: 6 * 60 * 60 * 1000,
  steamspy: 12 * 60 * 60 * 1000,
  itadId: 30 * 24 * 60 * 60 * 1000,
};
const AS_API = "https://api.augmentedsteam.com";
const ITAD_API = "https://api.isthereanydeal.com";
const STEAM_SHOP_ID = 61;
// 区服信息：代码 -> [名称, Steam 计价货币]（土区、阿区、中东、南亚等已改用美元计价）
const REGION_INFO = {
  CN: ["国区", "CNY"], HK: ["港区", "HKD"], TW: ["台区", "TWD"], JP: ["日区", "JPY"], KR: ["韩区", "KRW"],
  SG: ["新加坡", "SGD"], MY: ["马来西亚", "MYR"], TH: ["泰国", "THB"], ID: ["印尼", "IDR"], PH: ["菲律宾", "PHP"],
  VN: ["越南", "VND"], IN: ["印度", "INR"], PK: ["巴基斯坦", "USD"], KZ: ["哈萨克斯坦", "KZT"], RU: ["俄区", "RUB"],
  UA: ["乌克兰", "UAH"], TR: ["土区", "USD"], AR: ["阿区", "USD"], BR: ["巴西", "BRL"], MX: ["墨西哥", "MXN"],
  CL: ["智利", "CLP"], CO: ["哥伦比亚", "COP"], PE: ["秘鲁", "PEN"], UY: ["乌拉圭", "UYU"], CR: ["哥斯达黎加", "CRC"],
  US: ["美区", "USD"], CA: ["加拿大", "CAD"], GB: ["英区", "GBP"], DE: ["欧区", "EUR"], FR: ["法国", "EUR"],
  PL: ["波兰", "PLN"], NO: ["挪威", "NOK"], CH: ["瑞士", "CHF"], AU: ["澳区", "AUD"], NZ: ["新西兰", "NZD"],
  SA: ["沙特", "SAR"], AE: ["阿联酋", "AED"], IL: ["以色列", "ILS"], QA: ["卡塔尔", "QAR"], KW: ["科威特", "KWD"],
  EG: ["埃及", "USD"], ZA: ["南非", "ZAR"],
};
const DEFAULT_REGIONS = "CN/HK/TW/JP/KR/US/GB/DE/RU/UA/KZ/TR/AR/IN/BR";
// 近期史低的时间窗口
const WINDOWS = [
  ["y1", 365],
  ["m6", 182],
  ["d30", 30],
];
// ==================== 运行环境适配 ====================
// Surge / Loon / Stash / Shadowrocket 原生提供 $httpClient、$persistentStore；Quantumult X 用 $task.fetch、$prefs，返回格式也不同
const IS_QX = typeof $task !== "undefined" && typeof $httpClient === "undefined";
const HTTP = IS_QX ? qxHttpClient() : $httpClient;
const STORE = IS_QX
  ? { read: (k) => $prefs.valueForKey(k), write: (v, k) => $prefs.setValueForKey(v, k) }
  : $persistentStore;
const OPTS = parseOptions(typeof $argument !== "undefined" ? $argument : "");

function qxHttpClient() {
  const send = (method) => (opts, cb) =>
    $task.fetch({ url: opts.url, method, headers: opts.headers, body: opts.body }).then(
      (r) => cb(null, { status: r.statusCode, headers: r.headers }, r.body),
      (e) => cb((e && e.error) || String(e))
    );
  return { get: send("GET"), post: send("POST") };
}

// 统一的 $done：Quantumult X 的“返回伪造响应”需要 {status: "HTTP/1.1 200 OK", headers, body}
function finish(result) {
  if (IS_QX && result && result.response) {
    const r = result.response;
    const text = { 200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 502: "Bad Gateway" }[r.status] || "";
    return $done({ status: `HTTP/1.1 ${r.status} ${text}`.trim(), headers: r.headers, body: r.body });
  }
  $done(result);
}

if (typeof $response !== "undefined") {
  handleInject();
} else {
  handleApi();
}

// ==================== http-response：注入 ====================

function handleInject() {
  const headers = $response.headers || {};
  const contentType = getHeader(headers, "Content-Type") || "";
  let body = $response.body;

  if (!/text\/html/i.test(contentType) || typeof body !== "string" || body.indexOf(INJECT_MARK) !== -1) {
    return finish({});
  }

  const idx = body.lastIndexOf("</body>");
  if (idx === -1) {
    return finish({});
  }

  const cfg = {
    version: VERSION,
    prefix: ROUTE_PREFIX,
    country: OPTS.country,
    currency: OPTS.currency,
    features: OPTS.features,
    history: !!OPTS.itadKey,
    asApi: AS_API,
  };
  const snippet = `${INJECT_MARK}<script>(${enhanceFrontend.toString()})(${JSON.stringify(cfg)});</script>`;
  body = body.slice(0, idx) + snippet + body.slice(idx);
  console.log(`[Steam增强] 已注入: ${$request.url}`);
  const patched = allowConnect(headers, AS_API);
  finish(patched ? { body, headers: patched } : { body });
}

// 在 CSP 的 connect-src 中追加允许的源；没有 connect-src 或已包含时返回 null
function allowConnect(headers, origin) {
  let changed = false;
  const out = {};
  Object.keys(headers).forEach((k) => {
    let v = headers[k];
    if (k.toLowerCase() === "content-security-policy" && typeof v === "string" && /connect-src/.test(v) && v.indexOf(origin) === -1) {
      v = v.replace(/connect-src/, `connect-src ${origin}`);
      changed = true;
    }
    out[k] = v;
  });
  return changed ? out : null;
}

// ==================== http-request：同源 API ====================

function handleApi() {
  const pathMatch = $request.url.match(/^https:\/\/[^/]+(\/[^?#]*)(?:\?([^#]*))?/);
  const path = pathMatch ? pathMatch[1] : "";
  const query = parseQuery(pathMatch && pathMatch[2]);
  const route = path.slice(ROUTE_PREFIX.length);

  if ($request.method !== "GET") {
    return respond(405, { error: "method not allowed" });
  }

  switch (route) {
    case "api/ping":
      // 调试用：返回解析后的参数（不含 ITAD Key 本身）
      return respond(200, {
        ok: true,
        version: VERSION,
        env: detectEnv(),
        options: {
          country: OPTS.country || "auto",
          currency: OPTS.currency || "auto",
          regions: OPTS.regions,
          itadKey: !!OPTS.itadKey,
          features: OPTS.features,
        },
      });
    case "api/steamspy":
      return apiSteamSpy(query);
    case "api/players":
      return apiPlayers(query);
    case "api/history":
      return apiHistory(query);
    case "api/regions":
      return apiRegions(query);
    default:
      return respond(404, { error: "not found" });
  }
}

// 当前在线人数（Steam 官方）；峰值 / HLTB / 媒体评分由页面直接请求 Augmented Steam
function apiPlayers(query) {
  const appid = toId(query.appid);
  if (!appid) return respond(400, { error: "invalid appid" });

  withCache(`players:${appid}`, TTL.players, (cb) => {
    httpGet(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`, (err, d) => {
      if (err) return cb(err);
      const r = d && d.response;
      cb(null, { current: r && r.result === 1 ? r.player_count : null });
    });
  });
}

// SteamSpy 拥有者估算（该接口没有 CORS，只能由代理端请求）
function apiSteamSpy(query) {
  const appid = toId(query.appid);
  if (!appid) return respond(400, { error: "invalid appid" });

  withCache(`steamspy:${appid}`, TTL.steamspy, (cb) => {
    httpGet(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`, (err, d) => {
      if (err) return cb(err);
      cb(null, { owners: d && d.owners ? d.owners : null });
    });
  });
}

// 批量近期史低（需要 ITAD Key）；当前价由页面合并
function apiHistory(query) {
  const ids = parseItems(query);
  const cc = /^[A-Z]{2}$/.test(query.cc || "") ? query.cc : "CN";
  if (!ids.total) return respond(400, { error: "no items" });
  if (!OPTS.itadKey) return respond(200, { items: {}, history: false });

  withCache(`history:${cc}:${ids.key}`, TTL.history, (cb) => {
    // 一个都没查到时按失败处理，避免把空结果缓存 6 小时
    fetchWindows(ids.keys, cc, (windows) => (Object.keys(windows).length ? cb(null, { items: windows, history: true }) : cb("ITAD history unavailable")));
  });
}

// 近期史低（需要 ITAD API Key）：Steam 商店 ID -> ITAD 游戏 ID -> 价格变动记录，按时间窗口取最低价
function fetchWindows(keys, cc, done) {
  itadLookup(keys, (idMap) => {
    const targets = keys.filter((k) => idMap[k]);
    if (!targets.length) return done({});
    // ITAD 不接受带毫秒的时间（返回 400），去掉毫秒部分
    const since = new Date(Date.now() - 800 * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    parallel(
      targets.map((key) => (cb) =>
        httpGet(
          `${ITAD_API}/games/history/v2?id=${idMap[key]}&country=${cc}&shops=${STEAM_SHOP_ID}&since=${encodeURIComponent(since)}`,
          (err, d) => {
            if (err) console.log(`[Steam增强] ITAD 历史查询失败 ${key}: ${err}`);
            cb(err || !Array.isArray(d) ? null : d);
          },
          itadHeaders()
        )
      ),
      (histories) => {
        const out = {};
        targets.forEach((key, i) => {
          if (!histories[i]) return;
          out[key] = computeWindows(histories[i]);
        });
        done(out);
      }
    );
  });
}

// Steam 商店 ID（如 sub/440408）批量换 ITAD 游戏 ID，结果长期缓存
function itadLookup(keys, done) {
  const store = readCache();
  const idMap = {};
  const missing = [];
  keys.forEach((k) => {
    const hit = store[`itadid:${k}`];
    if (hit && Date.now() - hit.t < TTL.itadId) idMap[k] = hit.d;
    else missing.push(k);
  });
  if (!missing.length) return done(idMap);
  httpPostJson(`${ITAD_API}/lookup/id/shop/${STEAM_SHOP_ID}/v1`, missing, (err, d) => {
    if (err || !d) {
      console.log(`[Steam增强] ITAD 查询失败: ${err}`);
      return done(idMap);
    }
    const s = readCache();
    missing.forEach((k) => {
      idMap[k] = d[k] || null;
      s[`itadid:${k}`] = { t: Date.now(), d: idMap[k] };
    });
    writeCache(s);
    done(idMap);
  }, itadHeaders());
}

// ITAD Key 放在请求头而不是 URL，避免出现在请求记录里
function itadHeaders() {
  return { "ITAD-API-Key": OPTS.itadKey };
}

// 每个窗口的最低价 = 窗口内的所有价格变动 + 窗口开始时生效的价格 中的最低者（当前价由页面再合并）
function computeWindows(history, current) {
  const entries = history
    .filter((h) => h && h.deal && h.deal.price)
    .map((h) => ({
      t: new Date(h.timestamp).getTime(),
      amount: h.deal.price.amount,
      currency: h.deal.price.currency,
      cut: h.deal.cut || 0,
      timestamp: h.timestamp,
    }))
    .sort((a, b) => b.t - a.t);
  const out = {};
  WINDOWS.forEach(([name, days]) => {
    const cutoff = Date.now() - days * 86400000;
    const candidates = entries.filter((e) => e.t >= cutoff);
    const before = entries.find((e) => e.t < cutoff);
    if (before) candidates.push(Object.assign({}, before, { carried: true }));
    if (current) candidates.push({ amount: current.amount, currency: current.currency, cut: current.cut, timestamp: null, carried: true });
    if (!candidates.length) return;
    const min = candidates.reduce((a, b) => (b.amount < a.amount ? b : a));
    out[name] = {
      amount: min.amount,
      currency: min.currency,
      cut: min.cut,
      timestamp: min.carried ? null : min.timestamp,
    };
  });
  return out;
}

// 批量各区价格：每个区服一次 IStoreBrowseService/GetItems 查询所有商品；汇率换算由页面完成
function apiRegions(query) {
  const ids = parseItems(query);
  const cc = /^[A-Z]{2}$/.test(query.cc || "") ? query.cc : "CN";
  // 换算货币：模块参数 > 页面指定 > 基准区服货币
  const to = OPTS.currency || (/^[A-Z]{3}$/.test(query.to || "") ? query.to : regionInfo(cc)[1]);
  if (!ids.total) return respond(400, { error: "no items" });

  const reqIds = [].concat(
    ids.app.map((id) => ({ appid: id })),
    ids.sub.map((id) => ({ packageid: id })),
    ids.bundle.map((id) => ({ bundleid: id }))
  );
  const TYPE_NAMES = { 0: "app", 1: "sub", 2: "bundle" };

  const regions = OPTS.regions;
  withCache(`regions:${to}:${regions.join("")}:${ids.key}`, TTL.regions, (cb) => {
    const tasks = regions.map((rc) => (done) => {
      const input = { ids: reqIds, context: { language: "english", country_code: rc }, data_request: {} };
      httpGet(
        `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`,
        (err, d) => done(err || !d || !d.response ? null : d.response.store_items || [])
      );
    });
    parallel(tasks, (results) => {
      if (results.every((r) => r == null)) return cb("upstream failed");
      const items = {};
      ids.keys.forEach((key) => (items[key] = []));
      regions.forEach((rc, i) => {
        const [name, cur] = regionInfo(rc);
        const list = results[i] || [];
        const byKey = {};
        list.forEach((it) => (byKey[`${TYPE_NAMES[it.item_type]}/${it.id}`] = it));
        ids.keys.forEach((key) => {
          const it = byKey[key];
          const po = it && it.success === 1 && it.best_purchase_option;
          if (!po || po.final_price_in_cents == null) {
            items[key].push({ cc: rc, name, available: false });
            return;
          }
          const final = Number(po.final_price_in_cents) / 100;
          items[key].push({
            cc: rc,
            name,
            available: true,
            currency: cur,
            final,
            formatted: po.formatted_final_price,
            discount: po.discount_pct || 0,
          });
        });
      });
      cb(null, { to, items });
    });
  });
}

// 解析 apps/subs/bundles 参数（逗号分隔），限制数量防滥用
function parseItems(query) {
  const out = { app: [], sub: [], bundle: [], keys: [], total: 0 };
  [
    ["app", query.apps],
    ["sub", query.subs],
    ["bundle", query.bundles],
  ].forEach(([type, raw]) => {
    (raw || "")
      .split(",")
      .map(toId)
      .filter(Boolean)
      .forEach((id) => {
        if (out.total >= 30 || out[type].indexOf(id) !== -1) return;
        out[type].push(id);
        out.keys.push(`${type}/${id}`);
        out.total++;
      });
  });
  out.key = out.keys.slice().sort().join(",");
  return out;
}

// ==================== 缓存 / 网络 / 工具 ====================

function withCache(key, ttl, loader) {
  const hit = readCache()[key];
  if (hit && Date.now() - hit.t < ttl) {
    return respond(200, Object.assign({ cached: true }, hit.d));
  }
  loader((err, data) => {
    if (err) {
      // 上游失败时退回过期缓存
      if (hit) return respond(200, Object.assign({ cached: true, stale: true }, hit.d));
      return respond(502, { error: String(err) });
    }
    const store = readCache();
    store[key] = { t: Date.now(), d: data };
    writeCache(store);
    respond(200, data);
  });
}

function readCache() {
  try {
    return JSON.parse(STORE.read(CACHE_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

function writeCache(store) {
  const keys = Object.keys(store);
  if (keys.length > CACHE_MAX_ENTRIES) {
    keys
      .sort((a, b) => store[a].t - store[b].t)
      .slice(0, keys.length - CACHE_MAX_ENTRIES)
      .forEach((k) => delete store[k]);
  }
  STORE.write(JSON.stringify(store), CACHE_KEY);
}

function parallel(tasks, cb) {
  const out = new Array(tasks.length);
  let left = tasks.length;
  if (!left) return cb(out);
  tasks.forEach((task, i) =>
    task((r) => {
      out[i] = r;
      if (--left === 0) cb(out);
    })
  );
}

function httpGet(url, cb, headers) {
  HTTP.get({ url, timeout: 8, headers: Object.assign({ Accept: "application/json" }, headers) }, (err, resp, body) =>
    handleHttp(err, resp, body, cb)
  );
}

function httpPostJson(url, payload, cb, headers) {
  HTTP.post(
    {
      url,
      timeout: 8,
      headers: Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, headers),
      body: JSON.stringify(payload),
    },
    (err, resp, body) => handleHttp(err, resp, body, cb)
  );
}

function handleHttp(err, resp, body, cb) {
  if (err) return cb(err);
  const status = resp && (resp.status || resp.statusCode);
  if (status !== 200) return cb(`HTTP ${status}`);
  try {
    cb(null, JSON.parse(body));
  } catch (e) {
    cb("invalid json");
  }
}

function respond(status, data) {
  finish({
    response: {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify(data),
    },
  });
}

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  for (const k in headers) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}

function parseQuery(qs) {
  const out = {};
  (qs || "").split("&").forEach((pair) => {
    if (!pair) return;
    const i = pair.indexOf("=");
    const k = safeDecode(i === -1 ? pair : pair.slice(0, i));
    out[k] = i === -1 ? "" : safeDecode(pair.slice(i + 1));
  });
  return out;
}

function safeDecode(v) {
  try {
    return decodeURIComponent(v);
  } catch (e) {
    return v;
  }
}

function regionInfo(cc) {
  return REGION_INFO[cc] || [cc, "USD"];
}

// 解析模块参数：Surge 以 argument="KEY=VALUE&..." 传入；未填写 / auto / 未替换的占位符均视为默认
function parseOptions(raw) {
  // Surge / Stash / Shadowrocket 传字符串 "KEY=VALUE&..."；Loon 传对象 { KEY: value }
  const q = {};
  if (raw && typeof raw === "object") Object.keys(raw).forEach((k) => (q[k] = raw[k] == null ? "" : String(raw[k])));
  else Object.assign(q, parseQuery(String(raw || "")));
  const val = (k) => {
    const v = (q[k] || "").trim();
    // auto / none / 空 / 未替换的占位符 均视为未设置（Surge 参数不允许空默认值，ITAD_KEY 默认填 none）
    return !v || /^(auto|none|null|-)$/i.test(v) || /^\{\{\{/.test(v) ? "" : v;
  };
  const bool = (k, d) => {
    const v = val(k);
    return v ? !/^(false|0|off|no|关|否)$/i.test(v) : d;
  };
  const country = val("COUNTRY").toUpperCase();
  const currency = val("CURRENCY").toUpperCase();
  const regions = [];
  (val("REGIONS") || DEFAULT_REGIONS)
    .toUpperCase()
    .split(/[^A-Z]+/)
    .forEach((c) => {
      // 只接受内置区服（需要知道计价货币才能换算）
      if (REGION_INFO[c] && regions.indexOf(c) === -1 && regions.length < 30) regions.push(c);
    });
  return {
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "",
    regions,
    itadKey: val("ITAD_KEY"),
    features: {
      lowest: bool("LOWEST", true),
      history: bool("HISTORY", false), // 默认关闭：需要 ITAD Key，开启但未填 Key 时页面给出提示
      regions: bool("REGION_PRICE", true),
      stats: bool("STATS", true),
      rating: bool("RATING", true),
      ids: bool("IDS", true),
      buttons: bool("BUTTONS", true),
      agecheck: bool("AGECHECK", true),
      community: bool("COMMUNITY", true),
    },
  };
}

function toId(v) {
  return /^\d{1,10}$/.test(v || "") ? parseInt(v, 10) : 0;
}

function detectEnv() {
  if (typeof $environment !== "undefined" && $environment["surge-version"]) return "Surge";
  if (typeof $environment !== "undefined" && $environment["stash-version"]) return "Stash";
  if (typeof $loon !== "undefined") return "Loon";
  if (typeof $rocket !== "undefined") return "Shadowrocket";
  return "unknown";
}

// ==================== 前端（以源码形式内联进页面执行） ====================
// 注意：此函数会被 toString() 后注入页面，不能引用外部变量，也不能出现 script 结束标签字面量。
// 所有上游数据只通过 textContent 写入，不使用 innerHTML。

function enhanceFrontend(cfg) {
  if (window.__steamEnhance) return;
  window.__steamEnhance = cfg.version;

  const path = location.pathname;

  if (location.hostname === "steamcommunity.com") {
    if (cfg.features.community) community();
    return;
  }

  // ---------- 年龄验证自动跳过 ----------
  const age = path.match(/^\/agecheck\/(app|sub|bundle)\/(\d+)/);
  if (age) {
    if (!cfg.features.agecheck) return;
    const flag = `se_agecheck_${age[2]}`;
    let tried = false;
    try {
      tried = sessionStorage.getItem(flag) === "1";
      sessionStorage.setItem(flag, "1");
    } catch (e) {}
    // 每个商品只尝试一次，避免需要登录的限制页循环跳转
    if (!tried) {
      const exp = "; path=/; max-age=31536000; secure";
      document.cookie = "wants_mature_content=1" + exp;
      document.cookie = "birthtime=-729000000" + exp;
      document.cookie = "lastagecheckage=1-January-1947" + exp;
      location.replace(`/${age[1]}/${age[2]}/${location.search}`);
    }
    return;
  }

  const m = path.match(/^\/(app|sub|bundle)\/(\d+)/);
  if (!m) return;
  const type = m[1];
  const id = m[2];

  const pageConfig = (function () {
    try {
      return JSON.parse(document.getElementById("application_config").dataset.config) || {};
    } catch (e) {
      return {};
    }
  })();
  // 基准区服：模块参数 > 页面所在区服；换算货币：模块参数 > 基准区服货币（由代理端决定）> 页面货币
  const country = cfg.country || pageConfig.COUNTRY || "CN";
  const currencyMeta = document.querySelector('meta[itemprop="priceCurrency"]');
  const pageCurrency = (currencyMeta && currencyMeta.content) || "";
  const targetCurrency = cfg.currency || (cfg.country ? "" : pageCurrency);
  const F = cfg.features;
  const SDB = "https://steamdb.info/";

  injectStyle();
  if (type === "app") {
    if (F.buttons) addHeaderButtons();
    if (F.stats) addStatsBlock();
    if (F.rating) addRating();
  }
  if (F.ids) addPurchaseIds();
  if (F.lowest || F.regions) addPurchaseInfo();
  if (F.lowest) addDlcLowest();

  // ---------- 样式 ----------
  function injectStyle() {
    const style = document.createElement("style");
    style.textContent = `
.se_pi{margin:12px 0 10px;padding:8px 10px;border-radius:3px;background:rgb(0 0 0 / 20%);font-family:"Motiva Sans",Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#8f98a0}
.se_pi_row{display:flex;align-items:center;gap:10px}
.se_pi_low{flex:1;min-width:0;color:#8f98a0 !important;text-decoration:none}
.se_pi_low:hover{color:#c6d4df !important}
.se_pi_low b{color:#a3cf06;font-size:13px;font-weight:bold}
.se_pi_toggle{flex:none;border:0;border-radius:2px;padding:2px 10px;background:rgb(103 193 245 / 15%);color:#67c1f5;font-size:12px;line-height:18px;cursor:pointer}
.se_pi_toggle:hover{background:#67c1f5;color:#fff}
.se_pi_extra{font-style:italic}
.se_dlc_low{margin-top:2px;font-size:11px;line-height:16px;color:#8f98a0;white-space:normal}
.se_dlc_low b{color:#a3cf06;font-weight:bold}
.se_dlc_sum{margin:8px 0 4px;text-align:right;font-size:12px;color:#8f98a0}
.se_dlc_sum b{color:#a3cf06;font-weight:bold}
.se_dlc_low .se_tag{line-height:15px;font-size:10px}
.se_pi_windows{display:flex;flex-wrap:wrap;gap:2px 14px}
.se_pi_windows:empty{display:none}
.se_win b{color:#c6d4df;font-weight:bold}
.se_win b.se_win_low{color:#a3cf06}
.se_pi_regions{margin-top:8px;padding-top:6px;border-top:1px solid rgb(255 255 255 / 6%)}
.se_tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:2px;font-size:11px;line-height:18px;font-style:normal;vertical-align:1px;background:#4c6b22;color:#beee11}
.se_tag.alt{background:#2a475e;color:#67c1f5}
.se_id{align-self:center;height:auto !important;margin-right:6px;padding:0 6px !important;border-radius:2px;background:rgb(0 0 0 / 40%) !important;color:#8f98a0 !important;font-size:12px !important;line-height:20px !important}
.se_id:hover{color:#fff !important}
.se_id span{padding:0 !important;font-size:inherit !important;line-height:inherit !important}
.se_id b{font-weight:bold}
.se_block .block_content_inner{display:block}
.se_grid{display:grid;grid-template-columns:min-content 1fr;gap:2px 10px;white-space:nowrap;font-size:12px;color:#8f98a0;font-family:"Motiva Sans",Arial,Helvetica,sans-serif}
.se_num{font-weight:bold;color:#67c1f5;text-align:right}
.se_grid a{color:inherit}
.se_grid a:hover{color:#fff}
.se_sep{grid-column:1/-1;height:1px;margin:4px 0;background:rgb(255 255 255 / 8%)}
.se_muted{color:#626366}
.se_regions{font-family:"Motiva Sans",Arial,Helvetica,sans-serif;font-size:12px;color:#8f98a0}
.se_regions table{width:100%;border-collapse:collapse}
.se_regions td{padding:3px 0;white-space:nowrap}
.se_regions td+td{text-align:right;padding-left:8px}
.se_regions tr+tr td{border-top:1px solid rgb(255 255 255 / 5%)}
.se_regions .se_cur td{color:#fff}
.se_regions .se_best td:nth-child(3){color:#a3cf06;font-weight:bold}
.se_up{color:#e06c5a}
.se_down{color:#a3cf06}
.se_rating_good{color:#6c3 !important}
.se_rating_average{color:#fc3 !important}
.se_rating_poor{color:#e60 !important}
.se_rating_white{color:#aaa !important}
html.responsive .responsive_apppage_details_left.block.se_block{background-color:#1b2838 !important;border-radius:4px;padding:0 !important}
html.responsive .responsive_apppage_details_left.block.se_block .block_content_inner{margin:0;padding:12px 16px}`;
    document.head.appendChild(style);
  }

  // ---------- 顶部按钮：SteamDB / PCGamingWiki ----------
  function addHeaderButtons() {
    let container = document.querySelector(".apphub_OtherSiteInfo");
    if (!container) {
      const top = document.querySelector(".apphub_HeaderStandardTop");
      if (top) {
        container = el("div", "apphub_OtherSiteInfo");
        top.insertBefore(container, top.firstChild);
      }
    }
    const buttons = [
      ["SteamDB", `${SDB}app/${id}/`],
      ["PCGW", `https://www.pcgamingwiki.com/api/appid.php?appid=${id}`],
    ];
    if (container) {
      buttons.forEach(([text, href]) => {
        const a = link("btnv6_blue_hoverfade btn_medium", href);
        a.style.marginLeft = "3px";
        a.appendChild(el("span", "", text));
        container.appendChild(a);
      });
    }
    // 移动端（responsive）顶部按钮隐藏，额外加到“链接”栏
    const linkbars = document.querySelector("#appDetailsUnderlinedLinks .block_content_inner");
    if (linkbars) {
      buttons.forEach(([text, href]) => {
        const a = link("linkbar", href);
        a.textContent = `在 ${text} 上查看 `;
        a.appendChild(el("img", "", null, { src: "https://store.fastly.steamstatic.com/public/images/v5/ico_external_link.gif" }));
        linkbars.appendChild(a);
      });
    }
  }

  // ---------- 购买块 ID：# subid / # bundleid ----------
  function addPurchaseIds() {
    const seen = new Set();
    document.querySelectorAll('input[name="subid"], input[name="bundleid"]').forEach((input) => {
      const idVal = parseInt(input.value, 10);
      if (!idVal || seen.has(input.name + idVal)) return;
      seen.add(input.name + idVal);
      const block = input.closest(".game_area_purchase_game");
      const action = block && block.querySelector(".game_purchase_action");
      if (!action) return;
      const kind = input.name === "subid" ? "sub" : "bundle";
      const a = link("btn_black btn_tiny se_id", `${SDB}${kind}/${idVal}/`);
      a.title = `在 SteamDB 查看 ${kind} ${idVal}`;
      const span = el("span");
      span.appendChild(el("b", "", "# "));
      span.appendChild(document.createTextNode(String(idVal)));
      a.appendChild(span);
      action.insertBefore(a, action.firstChild);
    });
  }

  // ---------- 每个购买块：史低 + 各区价格 ----------
  function addPurchaseInfo() {
    const blocks = [];
    const seen = new Set();
    document.querySelectorAll('.game_area_purchase_game input[name="subid"], .game_area_purchase_game input[name="bundleid"]').forEach((input) => {
      const idVal = parseInt(input.value, 10);
      const kind = input.name === "subid" ? "sub" : "bundle";
      const key = `${kind}/${idVal}`;
      const block = input.closest(".game_area_purchase_game");
      const action = block && block.querySelector(".game_purchase_action");
      if (!idVal || !action || seen.has(key)) return;
      seen.add(key);
      blocks.push({ key, kind, id: idVal, block, action });
    });
    if (!blocks.length) return;

    const qs = (kind) => blocks.filter((b) => b.kind === kind).map((b) => b.id).join(",");
    const itemQuery = `subs=${qs("sub")}&bundles=${qs("bundle")}`;
    let regionsPromise = null;

    blocks.forEach((b, index) => {
      const pi = el("div", "se_pi");
      const row = el("div", "se_pi_row");
      b.low = link("se_pi_low", `https://isthereanydeal.com/steam/${b.kind}/${b.id}/`);
      b.low.textContent = F.lowest ? "史低查询中…" : "";
      row.appendChild(b.low);
      pi.appendChild(row);
      b.windows = el("div", "se_pi_windows");
      pi.appendChild(b.windows);
      b.extra = el("div", "se_pi_extra");
      pi.appendChild(b.extra);
      b.index = index;
      b.action.parentNode.insertBefore(pi, b.action);
      if (!F.regions) return;

      const toggle = el("button", "se_pi_toggle", "各区价格 ▾");
      toggle.type = "button";
      row.appendChild(toggle);
      const regions = el("div", "se_regions se_pi_regions");
      regions.hidden = true;
      pi.appendChild(regions);

      toggle.addEventListener("click", () => {
        if (!regions.hidden) {
          regions.hidden = true;
          toggle.textContent = "各区价格 ▾";
          return;
        }
        regions.hidden = false;
        toggle.textContent = "各区价格 ▴";
        if (regions.dataset.loaded) return;
        regions.textContent = "加载中…";
        if (!regionsPromise) {
          regionsPromise = api(`api/regions?${itemQuery}&cc=${country}&to=${targetCurrency}`)
            .then((d) => asGet(`/rates/v1?to=${d.to}`, 12 * 3600 * 1000).then((rates) => convertRegions(d, rates)))
            .catch((e) => {
            regionsPromise = null;
            throw e;
          });
        }
        regionsPromise
          .then((d) => {
            renderRegions(regions, d.items[b.key] || [], d.to);
            regions.dataset.loaded = "1";
          })
          .catch(() => (regions.textContent = "加载失败，请收起后重试"));
      });
    });

    if (!F.lowest) return;
    loadLowest(blocks)
      .then((items) => {
        blocks.forEach((b) => renderLowest(b, items[b.key]));
        if (!F.history || !cfg.history) return;
        return api(`api/history?cc=${country}&${itemQuery}`).then((h) =>
          blocks.forEach((b) => {
            const item = items[b.key];
            const lo = item && item.steam && item.steam.lowest;
            if (lo) renderWindows(b, mergeCurrent((h.items || {})[b.key], item.steam.current), lo);
          })
        );
      })
      .catch(() => blocks.forEach((b) => (b.low.textContent = "史低查询失败")));
  }

  // 史低：Augmented Steam 批量查询（仅 Steam 商店 + 全部商店各一次）
  function loadLowest(blocks) {
    const payload = (shops) => {
      const p = {
        country,
        apps: [],
        subs: blocks.filter((b) => b.kind === "sub").map((b) => b.id),
        bundles: blocks.filter((b) => b.kind === "bundle").map((b) => b.id),
        voucher: true,
      };
      if (shops) p.shops = shops;
      return p;
    };
    const ttl = 6 * 3600 * 1000;
    return Promise.all([
      asPost("/prices/v2", payload([61]), ttl).catch(() => null),
      asPost("/prices/v2", payload(null), ttl).catch(() => null),
    ]).then(([steamRes, allRes]) => {
      if (!steamRes && !allRes) throw new Error("prices failed");
      const items = {};
      blocks.forEach((b) => {
        const steam = steamRes && steamRes.prices && steamRes.prices[b.key];
        const all = allRes && allRes.prices && allRes.prices[b.key];
        if (!steam && !all) return;
        const base = steam || all;
        items[b.key] = {
          steam: steam ? { current: pickPrice(steam.current), lowest: pickPrice(steam.lowest) } : null,
          all: all ? { current: pickPrice(all.current), lowest: pickPrice(all.lowest) } : null,
          bundled: base.bundled || 0,
          urls: base.urls || {},
        };
      });
      return items;
    });
  }

  // ---------- “此游戏的内容”（DLC 列表）：每行显示 Steam 史低 ----------
  function addDlcLowest() {
    const rows = {};
    document.querySelectorAll("#gameAreaDLCSection .game_area_dlc_row[data-ds-appid]").forEach((row) => {
      const appid = parseInt(row.dataset.dsAppid, 10);
      const name = row.querySelector(".game_area_dlc_name");
      if (!appid || !name) return;
      (rows[appid] = rows[appid] || []).push(name);
    });
    const appids = Object.keys(rows).map(Number);
    if (!appids.length) return;

    // DLC 可能很多，按 50 个一批查询
    const batches = [];
    for (let i = 0; i < appids.length; i += 50) batches.push(appids.slice(i, i + 50));
    const sum = { low: 0, cur: 0, count: 0, currency: "" };
    Promise.all(
      batches.map((apps) =>
        asPost("/prices/v2", { country, apps, subs: [], bundles: [], voucher: true, shops: [61] }, 6 * 3600 * 1000)
          .then((d) => renderBatch(apps, d))
          .catch(() => {})
      )
    ).then(() => renderDlcSum(sum));

    function renderBatch(apps, d) {
      apps.forEach((appid) => {
        const item = d && d.prices && d.prices[`app/${appid}`];
        const lo = item && pickPrice(item.lowest);
        if (!lo) return;
        const cur = pickPrice(item.current);
        if (cur) {
          sum.low += lo.amount;
          sum.cur += cur.amount;
          sum.count++;
          sum.currency = lo.currency;
        }
        rows[appid].forEach((name) => {
          const line = el("div", "se_dlc_low");
          line.appendChild(document.createTextNode("史低 "));
          line.appendChild(el("b", "", money(lo.amount, lo.currency)));
          if (lo.cut) line.appendChild(document.createTextNode(` -${lo.cut}%`));
          if (lo.cut && lo.timestamp) line.appendChild(document.createTextNode(` · ${dateText(lo.timestamp)}`));
          if (!lo.cut) line.appendChild(el("span", "se_tag alt", "从未打折"));
          else if (cur && cur.amount <= lo.amount) line.appendChild(el("span", "se_tag", "当前即史低"));
          name.appendChild(line);
        });
      });
    }
  }

  // DLC 史低合计：放在“将所有 DLC 添加至购物车”上方
  function renderDlcSum(sum) {
    const section = document.getElementById("gameAreaDLCSection");
    if (!section || sum.count < 2) return;
    const line = el("div", "se_dlc_sum");
    line.appendChild(document.createTextNode(`${sum.count} 个 DLC 史低合计 `));
    line.appendChild(el("b", "", money(Math.round(sum.low * 100) / 100, sum.currency)));
    line.appendChild(document.createTextNode(`，当前合计 ${money(Math.round(sum.cur * 100) / 100, sum.currency)}`));
    const action = section.querySelector(".game_purchase_action");
    if (action) action.parentNode.insertBefore(line, action);
    else section.appendChild(line);
  }

  function pickPrice(p) {
    if (!p || !p.price) return null;
    return {
      amount: p.price.amount,
      currency: p.price.currency,
      cut: p.cut || 0,
      shop: p.shop ? p.shop.name : null,
      timestamp: p.timestamp || null,
    };
  }

  // 近期史低再与当前价比较（当前价低于窗口记录时以当前价为准）
  function mergeCurrent(windows, current) {
    if (!windows) return null;
    const out = {};
    Object.keys(windows).forEach((k) => {
      const w = windows[k];
      out[k] = current && (!w || current.amount < w.amount) ? { amount: current.amount, currency: current.currency, cut: current.cut, timestamp: null } : w;
    });
    return out;
  }

  function renderLowest(b, item) {
    b.low.textContent = "";
    const s = item && item.steam;
    const lo = s && s.lowest;
    if (!lo) {
      b.low.textContent = "Steam 史低：暂无记录";
      return;
    }
    if (item.urls && (item.urls.history || item.urls.info)) b.low.href = item.urls.history || item.urls.info;
    b.low.appendChild(document.createTextNode("Steam 史低 "));
    b.low.appendChild(el("b", "", money(lo.amount, lo.currency)));
    const parts = [];
    if (lo.cut) parts.push(`-${lo.cut}%`);
    // 从未打折时 ITAD 的时间只是开始收录的时间，不展示
    if (lo.cut && lo.timestamp) parts.push(`${dateText(lo.timestamp)}（${relText(lo.timestamp)}）`);
    parts.push(`进包 ${item.bundled} 次`);
    b.low.appendChild(document.createTextNode(` · ${parts.join(" · ")}`));
    if (!lo.cut) b.low.appendChild(el("span", "se_tag alt", "从未打折"));
    else if (s.current && s.current.amount <= lo.amount) b.low.appendChild(el("span", "se_tag", "当前即史低"));

    // 其他商店更低时额外提示
    const a = item.all;
    const lines = [];
    if (a && a.lowest && a.lowest.shop && a.lowest.shop !== "Steam" && a.lowest.amount < lo.amount) {
      lines.push(`全网史低 ${money(a.lowest.amount, a.lowest.currency)} @ ${a.lowest.shop}${a.lowest.timestamp ? ` · ${dateText(a.lowest.timestamp)}` : ""}`);
    }
    if (a && a.current && a.current.shop && a.current.shop !== "Steam" && s.current && a.current.amount < s.current.amount) {
      lines.push(`当前最低 ${money(a.current.amount, a.current.currency)} @ ${a.current.shop}（-${a.current.cut}%）`);
    }
    lines.forEach((t) => b.extra.appendChild(el("div", "", t)));

    // 开启了 HISTORY 但未配置 ITAD Key：只在第一个购买块提示一次
    if (F.history && !cfg.history && b.index === 0) {
      b.windows.appendChild(el("span", "se_muted", "已开启近期史低（HISTORY），请在模块参数填写 ITAD_KEY 后显示近一年 / 近半年 / 近 30 天史低"));
    }
  }

  function renderWindows(b, w, allLow) {
    if (!w) return;
    [
      ["y1", "近一年"],
      ["m6", "近半年"],
      ["d30", "近 30 天"],
    ].forEach(([k, label]) => {
      const v = w[k];
      if (!v) return;
      const cell = el("span", "se_win");
      cell.appendChild(document.createTextNode(`${label} `));
      cell.appendChild(el("b", v.amount <= allLow.amount ? "se_win_low" : "", money(v.amount, v.currency)));
      if (v.cut) cell.appendChild(document.createTextNode(` -${v.cut}%`));
      if (v.timestamp) cell.title = dateText(v.timestamp);
      b.windows.appendChild(cell);
    });
  }

  function convertRegions(d, rates) {
    Object.keys(d.items).forEach((key) =>
      d.items[key].forEach((r) => {
        if (!r.available) return;
        const rate = r.currency === d.to ? 1 : rates && rates[r.currency] && rates[r.currency][d.to];
        r.converted = rate ? Math.round(r.final * rate * 100) / 100 : null;
      })
    );
    return d;
  }

  function renderRegions(container, list, to) {
    const ok = list.filter((r) => r.available && r.converted != null);
    container.textContent = "";
    if (!ok.length) {
      container.textContent = "暂无区服价格";
      return;
    }
    const mine = ok.find((r) => r.cc === country);
    ok.sort((x, y) => x.converted - y.converted);
    const table = el("table");
    ok.forEach((r, i) => {
      const tr = el("tr", r.cc === country ? "se_cur" : i === 0 ? "se_best" : "");
      tr.appendChild(el("td", "", r.name + (r.discount ? ` -${r.discount}%` : "")));
      tr.appendChild(el("td", "", r.formatted || money(r.final, r.currency)));
      tr.appendChild(el("td", "", money(r.converted, to)));
      const diff = el("td");
      if (mine && r.cc !== country) {
        const pct = Math.round(((r.converted - mine.converted) / mine.converted) * 100);
        diff.textContent = `${pct > 0 ? "+" : ""}${pct}%`;
        diff.className = pct > 0 ? "se_up" : pct < 0 ? "se_down" : "";
      }
      tr.appendChild(diff);
      table.appendChild(tr);
    });
    container.appendChild(table);
    const unavailable = list.filter((r) => !r.available).map((r) => r.name);
    if (unavailable.length) container.appendChild(el("div", "se_muted", `该礼包未在以下区服销售：${unavailable.join("、")}`));
  }

  // ---------- 右侧数据块：在线 / 峰值 / HLTB / 媒体评分 ----------
  function addStatsBlock() {
    const meta = document.querySelector(".game_meta_data");
    if (!meta) return;

    const header = el("div", "responsive_block_header responsive_apppage_details_left", "游戏数据");
    const block = el("div", "block responsive_apppage_details_left se_block");
    const inner = el("div", "block_content_inner");
    const grid = el("div", "se_grid");
    inner.appendChild(grid);
    block.appendChild(inner);
    meta.insertBefore(block, meta.firstChild);
    meta.insertBefore(header, block);

    const rows = {};
    function row(key, label) {
      rows[key] = el("span", "se_num", "…");
      grid.appendChild(rows[key]);
      grid.appendChild(el("span", "", label));
    }
    row("current", "当前在线");
    row("peakToday", "今日峰值");
    row("peakAll", "历史峰值");
    row("owners", "拥有者估算");

    Promise.all([
      api(`api/players?appid=${id}`).catch(() => ({})),
      api(`api/steamspy?appid=${id}`).catch(() => ({})),
      asGet(`/app/${id}/v2`, 10 * 60 * 1000).catch(() => null),
    ])
      .then(([steam, spy, as]) => {
        rows.owners.textContent = spy.owners ? ownersText(spy.owners) : "-";
        const ap = (as && as.players) || {};
        const p = {
          current: steam.current != null ? steam.current : ap.recent,
          peakToday: ap.peak_today,
          peakAll: ap.peak_all,
        };
        ["current", "peakToday", "peakAll"].forEach((k) => {
          rows[k].textContent = p[k] != null ? num(p[k]) : "-";
        });
        const reviews = (as && as.reviews) || {};
        const d = { hltb: as && as.hltb, metauser: reviews.metauser, opencritic: reviews.opencritic };

        const extra = [];
        const h = d.hltb;
        if (h && (h.story || h.extras || h.complete)) {
          extra.push(["主线", hours(h.story), h.url], ["主线+支线", hours(h.extras), h.url], ["完美通关", hours(h.complete), h.url]);
        }
        if (d.metauser && d.metauser.score) extra.push(["Metacritic 用户", String(d.metauser.score), d.metauser.url]);
        if (d.opencritic && d.opencritic.score) extra.push(["OpenCritic", String(d.opencritic.score), d.opencritic.url]);
        if (extra.length) grid.appendChild(el("div", "se_sep"));
        extra.forEach(([label, value, href]) => {
          grid.appendChild(el("span", "se_num", value));
          const cell = el("span");
          if (href) {
            const a = link("", href);
            a.textContent = label;
            cell.appendChild(a);
          } else {
            cell.textContent = label;
          }
          grid.appendChild(cell);
        });
      })
      .catch(() => {
        Object.keys(rows).forEach((k) => (rows[k].textContent = "-"));
      });
  }

  // ---------- SteamDB 评分（本地按评测数计算，公式同 SteamDB） ----------
  function addRating() {
    const reviews = document.querySelector('div[data-featuretarget="appreviews"]');
    let opts = null;
    try {
      opts = JSON.parse(reviews.dataset.props).filter_options;
    } catch (e) {}
    if (!opts || opts.nReviewsPositive + opts.nReviewsNegative <= 0) return;

    const total = opts.nReviewsPositive + opts.nReviewsNegative;
    const avg = opts.nReviewsPositive / total;
    const score = avg - (avg - 0.5) * Math.pow(2, -Math.log10(total + 1));
    const cls = total < 500 ? "white" : score > 0.74 ? "good" : score > 0.49 ? "average" : "poor";
    const pct = `${(score * 100).toFixed(2)}%`;
    const tip = `${num(opts.nReviewsPositive)} 好评 / ${num(total)} 总评测`;

    const desktop = document.querySelector("#userReviews");
    if (desktop) {
      const row = link("user_reviews_summary_row", `${SDB}app/${id}/`);
      row.title = tip;
      row.appendChild(el("div", "subtitle column", "SteamDB 评分："));
      const summary = el("div", "summary column");
      summary.appendChild(el("span", `game_review_summary se_rating_${cls}`, pct));
      summary.appendChild(el("span", "responsive_hidden", ` (${num(total)})`));
      row.appendChild(summary);
      desktop.appendChild(row);
    }
    const mobile = document.querySelector("#userReviews_responsive");
    if (mobile) {
      const row = link("user_reviews_summary_row", `${SDB}app/${id}/`);
      row.title = tip;
      row.appendChild(el("div", "subtitle column", "SteamDB 评分"));
      const summary = el("div", "summary column");
      summary.appendChild(el("span", `game_review_summary se_rating_${cls}`, pct));
      summary.appendChild(el("span", "", ` (${num(total)})`));
      row.appendChild(summary);
      mobile.appendChild(row);
    }
  }

  // ==================== 社区页（steamcommunity.com） ====================
  function community() {
    const style = document.createElement("style");
    style.textContent = `
.achieveTxtHolder{position:relative}
.se_ach_pct{position:absolute;right:12px;bottom:6px;font-size:12px;line-height:16px;color:#8f98a0}
.se_ach_pct b{font-weight:bold;color:#67c1f5}
.se_ach_pct.se_rare b{color:#e4ae39}
.se_ach_pct.se_ultra b{color:#ff6b6b}
.se_ach_bar{margin:10px 0;padding:8px 12px;border-radius:3px;background:rgb(0 0 0 / 25%);color:#8f98a0;font-size:12px}
.se_ach_bar button{margin-left:8px;border:0;border-radius:2px;padding:2px 10px;background:rgb(103 193 245 / 15%);color:#67c1f5;font-size:12px;cursor:pointer}
.se_ach_bar button:hover{background:#67c1f5;color:#fff}
.se_market{margin:10px 0;padding:8px 10px;border-radius:3px;background:rgb(0 0 0 / 25%);font-size:12px;line-height:18px;color:#8f98a0}
.se_market b{color:#a3cf06;font-weight:bold}
.se_market a{color:#67c1f5}`;
    document.head.appendChild(style);

    const segs = location.pathname.split("/").filter(Boolean);
    // /id/<name> 或 /profiles/<steamid> 开头的页面
    if (segs[0] !== "id" && segs[0] !== "profiles") return;
    if (segs.length === 2) return profilePage();
    if (segs[2] === "stats" && segs[3]) return achievementsPage(segs[3]);
    if (segs[2] === "inventory") return inventoryPage();
  }

  // 个人资料：SteamDB 计算器 / SteamID
  function profilePage() {
    const data = window.g_rgProfileData;
    const links = document.querySelector(".profile_item_links");
    if (!data || !data.steamid || !links) return;
    const add = (label, value, href) => {
      const item = el("div", "profile_count_link ellipsis");
      const a = link("", href);
      a.appendChild(el("span", "count_link_label", label));
      a.appendChild(document.createTextNode(" "));
      a.appendChild(el("span", "profile_count_link_total", value));
      item.appendChild(a);
      links.appendChild(item);
    };
    add("SteamDB 计算器", "", `https://steamdb.info/calculator/${data.steamid}/`);
    add("SteamID", data.steamid, `https://steamdb.info/calculator/${data.steamid}/`);
  }

  // 个人成就：每项显示全球解锁率（取同源的全局成就统计页），支持按稀有度排序
  function achievementsPage(game) {
    if (!/tab=achievements/.test(location.search) && !/\/achievements\/?$/.test(location.pathname)) return;
    const holders = [...document.querySelectorAll(".achieveTxtHolder")];
    if (!holders.length) return;

    // 与当前页面使用同一语言，才能按成就名称对应
    const lang = new URLSearchParams(location.search).get("l");
    fetch(`/stats/${encodeURIComponent(game)}/achievements/${lang ? `?l=${encodeURIComponent(lang)}` : ""}`, { credentials: "same-origin" })
      .then((r) => r.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const pct = {};
        doc.querySelectorAll(".achieveRow").forEach((row) => {
          const name = row.querySelector("h3");
          const p = row.querySelector(".achievePercent");
          if (name && p) pct[name.textContent.trim()] = parseFloat(p.textContent);
        });
        let matched = 0;
        holders.forEach((h) => {
          const name = h.querySelector("h3");
          const v = name && pct[name.textContent.trim()];
          if (v == null || isNaN(v)) return;
          matched++;
          h.dataset.sePct = v;
          const line = el("div", `se_ach_pct${v < 1 ? " se_ultra" : v < 5 ? " se_rare" : ""}`);
          line.appendChild(document.createTextNode("全球解锁率 "));
          line.appendChild(el("b", "", `${v}%`));
          // 成就框高度固定，绝对定位到右下角，避免撑高后打乱浮动布局
          h.appendChild(line);
        });
        if (!matched) return;

        // 排序：按全球解锁率从低到高（最稀有在前），再次点击恢复原顺序
        const first = holders[0].previousElementSibling || holders[0];
        const bar = el("div", "se_ach_bar", `已匹配 ${matched} / ${holders.length} 个成就的全球解锁率`);
        const btn = el("button", "", "按稀有度排序");
        btn.type = "button";
        bar.appendChild(btn);
        first.parentNode.insertBefore(bar, first);
        const units = holders.map((h) => achievementUnit(h));
        let sorted = false;
        btn.addEventListener("click", () => {
          sorted = !sorted;
          btn.textContent = sorted ? "恢复原顺序" : "按稀有度排序";
          const order = sorted
            ? units.slice().sort((a, b) => (a.pct == null ? 101 : a.pct) - (b.pct == null ? 101 : b.pct))
            : units;
          const parent = units[0].nodes[0].parentNode;
          const anchor = units[units.length - 1].nodes[units[units.length - 1].nodes.length - 1].nextSibling;
          order.forEach((u) => u.nodes.forEach((n) => parent.insertBefore(n, anchor)));
        });
      })
      .catch(() => {});
  }

  // 一个成就在页面上由 图标 + 文字块 + 分隔元素 组成，排序时整体移动
  function achievementUnit(holder) {
    const nodes = [];
    const img = holder.previousElementSibling;
    if (img && img.classList.contains("achieveImgHolder")) nodes.push(img);
    nodes.push(holder);
    let n = holder.nextSibling;
    while (n && !(n.nodeType === 1 && (n.classList.contains("achieveImgHolder") || n.classList.contains("achieveTxtHolder")))) {
      nodes.push(n);
      n = n.nextSibling;
    }
    return { nodes, pct: holder.dataset.sePct ? parseFloat(holder.dataset.sePct) : null };
  }

  // 库存：选中可交易物品时显示社区市场价格；集换式卡牌显示徽章进度链接
  function inventoryPage() {
    const hook = () => {
      if (typeof window.RenderItemInfo !== "function" || window.RenderItemInfo.__se) return false;
      const original = window.RenderItemInfo;
      window.RenderItemInfo = function (name, description, asset) {
        const container = document.getElementById(name);
        // 信息框始终插在面板内部，只清理当前面板（另一个面板可能正在显示）
        if (container) container.querySelectorAll(".se_market").forEach((e) => e.remove());
        const ret = original.apply(this, arguments);
        try {
          if (container && description) renderMarket(container, description);
        } catch (e) {}
        return ret;
      };
      window.RenderItemInfo.__se = true;
      return true;
    };
    if (!hook()) document.addEventListener("DOMContentLoaded", hook);
  }

  function renderMarket(container, d) {
    const box = el("div", "se_market");

    let shown = false;

    // 集换式卡牌 / 补充包：徽章进度
    // 库存页没有 g_rgProfileData，库存主人用 g_ActiveUser
    const owner = window.g_ActiveUser && window.g_ActiveUser.strSteamId;
    if (d.appid === 753 && d.market_fee_app && owner) {
      const a = link("", `https://steamcommunity.com/profiles/${owner}/gamecards/${d.market_fee_app}/`);
      a.textContent = "查看徽章进度";
      box.appendChild(a);
      box.appendChild(el("br"));
      shown = true;
    }

    if (d.marketable && d.market_hash_name) {
      const cur = (window.g_rgWalletInfo && window.g_rgWalletInfo.wallet_currency) || steamCurrencyId(cfg.currency) || 23;
      const url = `/market/priceoverview/?appid=${d.appid}&currency=${cur}&market_hash_name=${encodeURIComponent(d.market_hash_name)}`;
      const line = el("div", "", "市场价格查询中…");
      box.appendChild(line);
      shown = true;
      fetch(url, { credentials: "same-origin" })
        .then((r) => r.json())
        .then((p) => {
          if (!p || !p.success) throw new Error("no price");
          line.textContent = "";
          line.appendChild(document.createTextNode("市场最低 "));
          line.appendChild(el("b", "", p.lowest_price || "-"));
          if (p.median_price) line.appendChild(document.createTextNode(` · 近期成交中位 ${p.median_price}`));
          if (p.volume) line.appendChild(document.createTextNode(` · 24 小时成交 ${p.volume}`));
          const a = link("", `https://steamcommunity.com/market/listings/${d.appid}/${encodeURIComponent(d.market_hash_name)}`);
          a.textContent = "  查看市场";
          line.appendChild(a);
        })
        .catch(() => (line.textContent = "暂时无法获取市场价格（可能被 Steam 限流）"));
    }
    if (!shown) return;
    const target = container.querySelector(".item_desc_description");
    if (target) target.parentNode.insertBefore(box, target.nextSibling);
    else (container.querySelector(".item_desc_content") || container).appendChild(box);
  }

  // 常用货币的 Steam 货币编号
  function steamCurrencyId(code) {
    const map = { USD: 1, GBP: 2, EUR: 3, CHF: 4, RUB: 5, PLN: 6, BRL: 7, JPY: 8, NOK: 9, IDR: 10, MYR: 11, PHP: 12, SGD: 13, THB: 14, VND: 15, KRW: 16, UAH: 18, MXN: 19, CAD: 20, AUD: 21, NZD: 22, CNY: 23, INR: 24, CLP: 25, PEN: 26, COP: 27, ZAR: 28, HKD: 29, TWD: 30, SAR: 31, AED: 32, ILS: 35, KZT: 37, KWD: 38, QAR: 39, CRC: 40, UYU: 41 };
    return map[code] || 0;
  }

  // ---------- 工具 ----------
  // Augmented Steam：页面直连（POST 用 text/plain 避免 CORS 预检），结果缓存在 localStorage
  function asGet(p, ttl) {
    return cached(`GET ${p}`, ttl, () => fetch(cfg.asApi + p, { credentials: "omit" }).then(json));
  }

  function asPost(p, payload, ttl) {
    const body = JSON.stringify(payload);
    return cached(`POST ${p} ${body}`, ttl, () =>
      fetch(cfg.asApi + p, { method: "POST", credentials: "omit", headers: { "Content-Type": "text/plain" }, body }).then(json)
    );
  }

  function json(r) {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function cached(key, ttl, load) {
    const k = `se_cache:${key}`;
    try {
      const hit = JSON.parse(localStorage.getItem(k) || "null");
      if (hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.d);
    } catch (e) {}
    return load().then((d) => {
      try {
        localStorage.setItem(k, JSON.stringify({ t: Date.now(), d }));
      } catch (e) {}
      return d;
    });
  }

  function api(p) {
    return fetch(cfg.prefix + p, { credentials: "omit" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  }

  function el(tag, cls, text, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    return e;
  }

  function link(cls, href) {
    const a = el("a", cls);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  function num(n) {
    return Number(n).toLocaleString("zh-CN");
  }

  function money(amount, cur) {
    try {
      return new Intl.NumberFormat("zh-CN", { style: "currency", currency: cur }).format(amount);
    } catch (e) {
      return `${amount} ${cur}`;
    }
  }

  // SteamSpy 的 "20,000,000 .. 50,000,000" 格式化为 "2000万 ~ 5000万"
  function ownersText(v) {
    const parts = String(v)
      .split("..")
      .map((x) => Number(x.replace(/[^\d]/g, "")))
      .filter((x) => !isNaN(x));
    if (parts.length !== 2) return String(v);
    const fmt = (n) => (n >= 1e8 ? `${n / 1e8}亿` : n >= 1e4 ? `${n / 1e4}万` : num(n));
    return `${fmt(parts[0])} ~ ${fmt(parts[1])}`;
  }

  function hours(min) {
    if (!min) return "-";
    const h = min / 60;
    return h >= 10 ? `${Math.round(h)} 小时` : `${h.toFixed(1)} 小时`;
  }

  function dateText(ts) {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(ts));
  }

  function relText(ts) {
    const days = Math.round((new Date(ts).getTime() - Date.now()) / 86400000);
    const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
    const abs = Math.abs(days);
    if (abs >= 365) return rtf.format(Math.round(days / 365), "year");
    if (abs >= 30) return rtf.format(Math.round(days / 30), "month");
    return rtf.format(days, "day");
  }
}
