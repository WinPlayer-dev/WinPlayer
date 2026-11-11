/**
 * 自动更新的前端 IPC 层：检查更新、下载（含进度事件）、安装。
 * 具体的流程编排（何时弹窗、忽略版本、自动检查频率）见 stores/updater.ts。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { t } from "@/i18n";

/** Rust 侧上报下载进度的事件名 */
export const UPDATE_PROGRESS_EVENT = "update://progress";

/**
 * 安装包类型（与 Rust 侧 InstallerKind 的 kebab-case 序列化结果一致）。
 * 对应 release 产物命名 `WinPlayer-{版本}-{平台}-{架构}[-类型].{扩展名}`。
 */
export type InstallerKind =
  | "windows-nsis"
  | "windows-msi"
  | "macos-dmg"
  | "linux-appimage"
  | "linux-deb"
  | "linux-rpm"
  | "android-apk";

/** 安装包类型的中文名 */
export const INSTALLER_LABELS: Record<InstallerKind, string> = {
  "windows-nsis": t("errors.generic.update.installer.windowsNsis"),
  "windows-msi": t("errors.generic.update.installer.windowsMsi"),
  "macos-dmg": t("errors.generic.update.installer.macosDmg"),
  "linux-appimage": t("errors.generic.update.installer.linuxAppImage"),
  "linux-deb": t("errors.generic.update.installer.linuxDeb"),
  "linux-rpm": t("errors.generic.update.installer.linuxRpm"),
  "android-apk": t("errors.generic.update.installer.androidApk"),
};

export function installerLabel(kind: InstallerKind): string {
  return INSTALLER_LABELS[kind] ?? kind;
}

/** GitHub release 中匹配到的可用更新 */
export interface UpdateInfo {
  /** 去掉 v 前缀的版本号，如 1.4.0 */
  version: string;
  /** release 标签，如 v1.4.0 */
  tag: string;
  /** release 标题 */
  name: string;
  /** release 说明（Markdown 原文） */
  notes: string;
  publishedAt: string | null;
  /** 是否为预发布版本 */
  prerelease: boolean;
  /** 当前平台将使用的安装包类型 */
  installer: InstallerKind;
  assetName: string;
  /** 已应用镜像前缀的下载地址 */
  assetUrl: string;
  /** 安装包字节数（0 表示未知） */
  assetSize: number;
  /** release 页面地址 */
  htmlUrl: string;
}

/** 检查结果：两者皆空表示已是最新版本 */
export interface CheckResult {
  update: UpdateInfo | null;
  /** 有新版本但没有当前平台可用的安装包 */
  unsupportedVersion: string | null;
}

/** 下载进度 */
export interface UpdateProgress {
  downloaded: number;
  total: number;
  /** 平均速度（字节/秒） */
  speed: number;
}

export interface DownloadResult {
  /** 安装包落盘路径 */
  path: string;
  size: number;
}

/** 当前平台信息 */
export interface PlatformInfo {
  platform: string;
  arch: string;
  /** 为空表示当前平台不支持自动更新 */
  installer: InstallerKind | null;
  installerLabel: string | null;
  releasesUrl: string;
}

/** 当前平台与可用的安装包类型 */
export function fetchPlatformInfo(): Promise<PlatformInfo> {
  return invoke<PlatformInfo>("updater_platform");
}

/** 查询更新；currentVersion 为当前应用版本号（如 1.5.0） */
export function checkForUpdate(
  currentVersion: string,
  includePrerelease: boolean,
  mirror: string,
): Promise<CheckResult> {
  return invoke<CheckResult>("updater_check", {
    currentVersion,
    includePrerelease,
    mirror,
  });
}

/** 下载安装包到应用缓存目录 */
export function downloadUpdate(
  url: string,
  fileName: string,
  expectedSize?: number,
): Promise<DownloadResult> {
  return invoke<DownloadResult>("updater_download", {
    url,
    fileName,
    expectedSize: expectedSize ?? null,
  });
}

/** 取消正在进行的下载 */
export function cancelUpdateDownload(): Promise<void> {
  return invoke("updater_download_cancel");
}

/** 安装已下载的更新包（桌面端会随后退出应用） */
export function installUpdate(path: string, installer: InstallerKind): Promise<void> {
  return invoke("updater_install", { path, installer });
}

/** 订阅下载进度，返回取消订阅函数 */
export function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>(UPDATE_PROGRESS_EVENT, (event) => handler(event.payload));
}

/** 字节数格式化（B/KB/MB/GB） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const text = index === 0 || value >= 100 ? Math.round(value) : value.toFixed(1);
  return `${text} ${units[index]}`;
}

/** 判断错误是否来自用户主动取消下载 */
export function isCanceledError(error: unknown): boolean {
  // i18n-ignore：比对的是 **Rust 侧**的取消文案（原生层未接 i18n），不是界面文案
  return String(error).includes("已取消");
}
