/*
 * 生成离线测试用的本地模块：script-path 改为相对路径，脚本与模块放在 Surge 配置目录（iCloud）根目录即可使用。
 * 用法：npm run local            → 输出到 dev/local/
 *       npm run local -- <目录>   → 直接输出到指定目录（如 Surge 的 iCloud 目录）
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const outDir = path.resolve(process.argv[2] || path.join(__dirname, "local"));
const SCRIPT_NAME = "steam_enhance.js";
const MODULE_NAME = "steam_enhance.local.sgmodule";

let mod = fs.readFileSync(path.join(ROOT, "surge", "steam_enhance.sgmodule"), "utf8");
mod = mod
  .replace(/^#!name=(.*)$/m, "#!name=$1（本地测试）")
  .replace(/script-path=[^,\s]+/g, `script-path=${SCRIPT_NAME},debug=true`);
// debug=true：每次运行都从文件重新加载脚本（改完无需重载配置），console.log 显示在请求的备注里

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, MODULE_NAME), mod);
fs.copyFileSync(path.join(ROOT, "scripts", SCRIPT_NAME), path.join(outDir, SCRIPT_NAME));
console.log(`已生成：\n  ${path.join(outDir, MODULE_NAME)}\n  ${path.join(outDir, SCRIPT_NAME)}`);
