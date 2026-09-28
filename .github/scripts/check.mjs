/*
 * 仓库检查：脚本语法、模块格式、覆写 YAML。
 * 本地运行：node .github/scripts/check.mjs（YAML 检查需要 js-yaml，可在 steam_enhance/dev 下 npm i 后使用）
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const errors = [];
const warnings = [];
const read = (f) => readFileSync(path.join(root, f), "utf8");
const fail = (f, msg) => errors.push(`${f}: ${msg}`);

// ---------- JavaScript 语法 ----------
for (const f of files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, f)], { stdio: "pipe" });
  } catch (e) {
    fail(f, `语法错误\n${String(e.stderr).trim()}`);
  }
}

// ---------- Surge / Shadowrocket 模块 ----------
for (const f of files.filter((f) => /\.(sgmodule|module)$/.test(f))) {
  const lines = read(f).split(/\r?\n/);
  const declared = new Set();
  let inHeader = true;
  let section = "";
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    if (/^\[.+\]$/.test(line.trim())) {
      inHeader = false;
      section = line.trim();
      return;
    }
    // 头部只能是 #! 元数据、注释或空行（参数说明里误写的真实换行会落在这里）
    if (inHeader && line.trim() && !line.startsWith("#")) errors.push(`${at}: 头部出现非注释行，可能是元数据中混入了换行`);
    const args = line.match(/^#!arguments=(.*)$/);
    if (args) {
      for (const item of args[1].split(",")) {
        const [name, ...rest] = item.split(":");
        if (!/^[A-Za-z0-9_]+$/.test(name.trim())) errors.push(`${at}: 参数名只能包含字母、数字、下划线：${name}`);
        // Surge 不接受空默认值（如 KEY:），会报“参数声明格式错误”
        if (item.includes(":") && !rest.join(":").trim()) errors.push(`${at}: 参数 ${name} 的默认值为空，Surge 不接受，请填写默认值（如 none）`);
        declared.add(name.trim());
      }
    }
    if (section === "[Script]" && line.trim() && !line.startsWith("#") && !/script-path=/.test(line)) {
      errors.push(`${at}: [Script] 行缺少 script-path`);
    }
  });
  for (const m of read(f).matchAll(/\{\{\{([^}]+)\}\}\}/g)) {
    if (!declared.has(m[1])) fail(f, `占位符 {{{${m[1]}}}} 未在 #!arguments 中声明`);
  }
}

// ---------- Loon 插件 ----------
for (const f of files.filter((f) => f.endsWith(".plugin"))) {
  const text = read(f);
  const declared = new Set();
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.+\]$/.test(line.trim())) section = line.trim();
    else if (section === "[Argument]" && line.includes("=")) declared.add(line.split("=")[0].trim());
  }
  for (const m of text.matchAll(/argument=\[([^\]]*)\]/g)) {
    for (const ref of m[1].matchAll(/\{([^}]+)\}/g)) {
      if (!declared.has(ref[1])) fail(f, `argument 引用了未在 [Argument] 中声明的参数 {${ref[1]}}`);
    }
  }
}

// ---------- Stash 覆写 YAML ----------
const stoverrides = files.filter((f) => f.endsWith(".stoverride"));
let yaml = null;
for (const base of [root, path.join(root, "steam_enhance", "dev")]) {
  try {
    yaml = createRequire(path.join(base, "noop.js"))("js-yaml");
    break;
  } catch (e) {}
}
if (!yaml) {
  warnings.push("未找到 js-yaml，跳过 .stoverride 的 YAML 检查");
} else {
  for (const f of stoverrides) {
    try {
      const doc = yaml.load(read(f));
      if (!doc || typeof doc !== "object") fail(f, "YAML 内容为空");
    } catch (e) {
      fail(f, `YAML 解析失败：${e.message.split("\n")[0]}`);
    }
  }
}

warnings.forEach((w) => console.log(`⚠️  ${w}`));
if (errors.length) {
  errors.forEach((e) => console.log(`❌ ${e}`));
  console.log(`\n检查未通过：${errors.length} 个问题`);
  process.exit(1);
}
console.log(`✅ 检查通过（${files.length} 个文件）`);
