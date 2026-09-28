# Steam 商店增强 项目计划

> 目标：用 Surge 等代理工具的 MITM + 脚本能力，在 Steam App / 网页版 / 桌面客户端的商店与社区页实现 SteamDB 扩展、Augmented Steam 类增强功能。
> 最后更新：2026-09-28（v0.7.0）

## 关键决策

| 决策 | 结论 | 依据 |
|---|---|---|
| 注入方式 | http-response 在 `</body>` 前内联脚本，CSP 只在 `connect-src` 追加 Augmented Steam | store / community CSP `script-src` 含 `'unsafe-inline'`；Watt Toolkit 直接删 CSP，我们只做最小放行 |
| 数据通道 | 同源伪路径 `/__steam_enhance/api/*` + http-request 代理（Steam / ITAD / SteamSpy）；Augmented Steam 由页面直连 | Surge `$httpClient` 与 Augmented Steam TLS 不兼容（服务端要求 P-256+P-384） |
| 史低数据源 | Augmented Steam `prices/v2`（ITAD 数据，免 Key）；近期史低用 ITAD 官方 `games/history/v2`（需 Key） | ITAD 旧 `esapi` 已失效；Augmented Steam 无历史端点 |
| SteamDB | 只放跳转链接；SteamDB 评分按公开公式本地计算 | `extension.steamdb.info` 为官方扩展专用，实测非浏览器访问被封 IP |
| MITM 范围 | store.steampowered.com、steamcommunity.com；不含 login / checkout / api | 安全；原生 API 可能证书绑定 |
| 命名 | 界面用中文描述，内部前缀 `se_`、路由 `/__steam_enhance/` | 用户不要自造品牌名 |

## 阶段

### 阶段 0：调研 ✅
- [x] 官方扩展源码：功能按页面划分（store/community），API 为 ExtensionApp / ExtensionAppPrice / ExtensionGetAchievements
- [x] Watt Toolkit 实现：注入中间件、`/WattToolkit_Inject/` 同源脚本、`local.steampp.net` xhr 转发 + GM 兼容层
- [x] Steam store / community CSP、X-Frame-Options 实测
- [x] 数据源可用性实测（Steam、Augmented Steam、ITAD、SteamSpy 可用；esapi、SteamDB 不可用）

### 阶段 1：注入链路 ✅（真机页面效果待确认）
- [x] `scripts/steam_enhance.js` 注入 + 同源 API + 持久化缓存；`surge/steam_enhance.sgmodule`
- [x] Node 模拟 Surge 环境单测；本地预览环境 `dev/`（MITM 代理 + Surge API 模拟 + 独立 Chrome + 无头截图）
- [x] 离线真机测试方案：局域网服务 `npm run lan`（手机 Surge 从本机安装模块）、本地模块 `npm run local`
- [x] 真机排障：通过 Surge HTTP API 定位 Augmented Steam TLS 不兼容；手机上 Steam / ITAD / GetItems 接口均验证可达
- [x] 推送到 GitHub
- [ ] **真机确认页面效果**（iOS Steam App 内置浏览器 / Safari）——需用户在手机上更新模块后查看
- [ ] macOS Steam 客户端验证（CEF 是否信任系统 CA）——需用户在 Mac 上验证

### 阶段 2：商店页功能 ✅
- [x] 顶部 SteamDB / PCGW 按钮 + 手机端链接栏
- [x] 每个购买块：Steam 史低、日期/相对时间、进包次数、从未打折/当前即史低标记、全网史低、其他商店当前更低（v0.3.0 起下沉到购买块）
- [x] 每个购买块：近一年 / 近半年 / 近 30 天史低（ITAD，窗口最低 = 窗口内变动 ∪ 窗口起点生效价 ∪ 当前价；真实 Key 联调通过）
- [x] 每个购买块：各区价格（GetItems 批量，页面按汇率换算、排序、差价）
- [x] 购买块 `# subid/bundleid`
- [x] “此游戏的内容”DLC 列表每行史低 + DLC 史低合计 / 当前合计
- [x] 右侧数据块：当前在线 / 今日峰值 / 历史峰值 / 拥有者估算（SteamSpy）/ HLTB / Metacritic 用户 / OpenCritic
- [x] SteamDB 评分（本地公式）；年龄验证自动跳过（每商品只尝试一次防循环）
- [x] 模块参数：COUNTRY、CURRENCY、REGIONS、ITAD_KEY、HISTORY（默认关）及各功能开关；`none` 作为空值（Surge 不接受空默认值）
- [x] sub / bundle 页面实测（sub/12467、bundle/727：史低与各区价格正常）
- [x] 桌面 1280 / 手机 390（Steam App UA）截图检查
- [x] 调研结论：Augmented Steam 服务端没有愿望单人数、SteamSpy 端点 → 拥有者估算直接用 SteamSpy（无 CORS，走代理端）；DLC 汇总价已实现；愿望单人数没有公开数据源，不做

### 阶段 3：社区页 ✅
- [x] CSP 分析：与商店相同（inline 允许、connect-src 含 'self'），同样的注入方式可用
- [x] 个人成就页：每项显示全球解锁率（同源抓全局成就页按名称匹配），稀有度着色，可按稀有度排序
- [x] 个人资料页：SteamDB 计算器链接、SteamID
- [x] 库存页：包装 `RenderItemInfo`，选中可交易物品显示市场最低价 / 成交中位价 / 24 小时成交量；卡牌与补充包显示徽章进度链接
- [x] 不做“快速出售”：会直接在市场挂单卖出物品，误操作有实际损失

### 阶段 4：多工具适配与发布 ✅（其他工具待真机验证）
- [x] 脚本运行环境适配层：Quantumult X（`$task.fetch` / `$prefs` / 伪造响应格式）、Loon（`$argument` 为对象、开关为布尔值）
- [x] Loon 插件（含 [Argument] 参数表）、Stash 覆写、Shadowrocket 模块、Quantumult X 重写配置
- [x] Node 模拟 Surge / QX / Loon 三种运行环境测试通过；Stash YAML 校验通过
- [x] README 完整说明与截图（`images/`，`npm run shot:readme` 可重新生成）
- [ ] Loon / Stash / Shadowrocket / Quantumult X 真机验证——需对应工具

### 阶段 5：GM 兼容层 ❌ 不做
- 原因：现有功能都已原生实现，没有需要复用的具体油猴脚本；通用的 `/xhr` 转发会让任何注入页面的脚本借代理访问任意地址，安全面过大。若以后有明确要复用的脚本，再按白名单单独评估。

## 风险 / 阻塞

- 真机页面效果尚未确认（需用户更新模块后查看）
- MITM steamcommunity.com 可能影响 Steam App 的交易确认、聊天（若异常，删掉该主机名或关闭 COMMUNITY）
- Augmented Steam / SteamSpy 为第三方服务，无 SLA；已做缓存与失败降级（过期缓存兜底、失败不缓存）
- 社区市场接口有频率限制
