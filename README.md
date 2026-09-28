# 个人脚本工具集

适用于 iOS / macOS 代理工具（Surge、Loon、Stash、Shadowrocket、Quantumult X）的模块与脚本，通过 MITM + JavaScript 为日常使用的 App 和网页提供辅助功能。

## 项目列表

| 项目 | 状态 | 支持工具 | 说明 |
|---|---|---|---|
| [Steam 商店增强](steam_enhance/) | ✅ 维护中 | Surge · Loon · Stash · Shadowrocket · Quantumult X | 在 Steam 商店与社区页显示每个礼包的史低与近期史低、各区价格对比、DLC 史低、在线与峰值、HLTB、SteamDB 评分，社区成就全球解锁率、库存市场价等，功能对标 SteamDB / Augmented Steam 浏览器扩展 |
| [全能签安装修复](qnq_install_fix/) | ✅ 维护中 | Surge · Loon · Stash · Shadowrocket · Quantumult X | 修复全能签因无法访问 `127.0.0.1` 导致的 App 安装失败，自动替换为设备局域网 IP |
| [龙湖 APP 自动签到](longfor/) | ⛔ 已废弃 | Surge | 龙湖 APP 每日签到与抽奖。不再维护，可能已失效 |
| [小米汽车订单监控](xiaomi_ev_order_monitor/) | ⛔ 已废弃 | Surge · Loon · Stash · Shadowrocket · Quantumult X | 追踪小米汽车订单状态并推送通知。不再维护，可能已失效 |

## 使用方法

1. 进入对应项目目录，按 README 复制所用工具的模块 / 插件 / 覆写地址并安装。
2. 在代理工具中开启 MITM，并安装、信任 CA 证书（各模块会自动追加所需的 MITM 主机名）。
3. 部分模块提供参数（如 Steam 商店增强的区服、货币、功能开关），在工具的模块参数界面修改。

所有模块的脚本都直接引用本仓库 `master` 分支的 raw 地址，更新后代理工具会按其脚本更新周期自动拉取。

## 目录结构

每个项目目录下按工具分子目录：

```
<项目>/
├── README.md        项目说明
├── scripts/         脚本（各工具共用）
├── surge/           Surge 模块（.sgmodule）
├── loon/            Loon 插件（.plugin）
├── stash/           Stash 覆写（.stoverride）
├── shadowrocket/    Shadowrocket 模块（.module）
└── qx/              Quantumult X 配置（.conf）
```

仓库根目录：

```
.github/             检查脚本与 GitHub Actions
.editorconfig        编辑器格式约定
.gitattributes       统一 LF 换行
.gitignore
```

## 免责声明

- 本仓库仅供学习交流使用，请勿用于商业或非法用途。
- 脚本依赖各 App / 网站的非公开接口，接口变更可能导致失效。
- 使用本仓库代码造成的任何后果由使用者自行承担。

## 贡献

欢迎提交问题或改进建议，也欢迎通过 Pull Request 贡献代码。

提交前可运行 `node .github/scripts/check.mjs` 自检，GitHub Actions 也会在每次推送时自动检查：

- 所有脚本的 JavaScript 语法
- Surge / Shadowrocket 模块：头部元数据格式、`#!arguments` 默认值不能为空、`{{{参数}}}` 占位符均已声明、`[Script]` 行包含 `script-path`
- Loon 插件：`argument=[{参数}]` 引用的参数均在 `[Argument]` 中声明
- Stash 覆写：YAML 可正常解析

编辑器请遵循 `.editorconfig`（UTF-8、LF、2 空格缩进）。
