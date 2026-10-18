/**
 * 把 src-tauri/icons/android 里由 `tauri icon` 生成的启动图标（mipmap-* / drawable / values）
 * 整棵树同步进 gen/android 工程。
 *
 * 背景：Tauri 的 android 模板自带一套「默认启动图标」，`tauri android init` 只负责解压
 * 模板，不会用 src-tauri/icons/android 覆盖它（只有 `tauri icon` 在 gen/android 已存在时
 * 才会写入 app/src/main/res）。因此在 `tauri android init` 之后、构建之前必须执行本脚本，
 * 否则 APK 始终显示 Tauri 默认图标。
 *
 * 用法：pnpm android:icons   （或 node scripts/apply-android-icons.mjs）
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src-tauri", "icons", "android");
const resDir = join(root, "src-tauri", "gen", "android", "app", "src", "main", "res");

if (!existsSync(resDir)) {
  console.error(`[android-icons] 未找到 ${resDir}`);
  console.error("[android-icons] 请先执行：pnpm tauri android init");
  process.exit(1);
}
if (!existsSync(srcDir)) {
  console.error(`[android-icons] 未找到图标源目录 ${srcDir}`);
  console.error("[android-icons] 请先执行：pnpm tauri icon build-assets/app-icon.png");
  process.exit(1);
}

// 递归收集源目录下的所有文件，保持相对路径一一对应地覆盖到 res/ 下
function collect(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...collect(full));
    else files.push(relative(srcDir, full));
  }
  return files;
}

const files = collect(srcDir);
for (const rel of files) {
  const to = join(resDir, rel);
  mkdirSync(dirname(to), { recursive: true });
  rmSync(to, { force: true });
  cpSync(join(srcDir, rel), to);
}

console.log(`[android-icons] 已同步 ${files.length} 个文件到 ${resDir}`);
for (const rel of files.sort()) console.log(`  ${rel}`);
