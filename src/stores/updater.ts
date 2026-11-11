/**
 * 自动更新流程编排：启动时静默检查、有更新时弹窗确认、下载（带进度）、按平台安装。
 *
 * 交互约定：
 * - 自动检查（静默）不打扰用户：仅在有新版本时弹出「发现新版本」弹窗；
 *   用户已「忽略此版本」的版本在自动检查时不再弹窗（手动检查仍会展示）。
 * - 用户在弹窗中确认后才下载，下载期间可以取消或转到后台继续。
 */

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { getVersion } from "@tauri-apps/api/app";
import { t } from "@/i18n";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/services/toast";
import {
  cancelUpdateDownload,
  checkForUpdate,
  downloadUpdate,
  fetchPlatformInfo,
  installUpdate,
  isCanceledError,
  onUpdateProgress,
  type InstallerKind,
  type PlatformInfo,
  type UpdateInfo,
  type UpdateProgress,
} from "@/services/updater";

/** 更新流程阶段 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "done"
  | "error";

/** 弹窗状态：无 / 询问是否更新 / 下载安装进度 */
export type UpdateDialogMode = "none" | "prompt" | "progress";

/** 「每 24 小时」的检查间隔 */
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const useUpdaterStore = defineStore("updater", () => {
  const settings = useSettingsStore();

  const phase = ref<UpdatePhase>("idle");
  const dialog = ref<UpdateDialogMode>("none");
  const info = ref<UpdateInfo | null>(null);
  const unsupportedVersion = ref<string | null>(null);
  const error = ref<string | null>(null);
  const progress = ref<UpdateProgress>({ downloaded: 0, total: 0, speed: 0 });
  const currentVersion = ref("");
  const platform = ref<PlatformInfo | null>(null);
  const ready = ref(false);

  /** 下载进度事件的取消订阅函数 */
  let stopProgress: UnlistenFn | null = null;

  const hasUpdate = computed(() => info.value !== null);
  /** 当前平台是否支持自动更新（iOS 等平台为 false） */
  const canAutoUpdate = computed(() => platform.value?.installer != null);
  /** 自动检查会被忽略的版本号（用户选择过「忽略此版本」） */
  const ignoredVersion = computed(() =>
    info.value && settings.ignoredUpdateVersion === info.value.version ? info.value.version : "",
  );
  /** 下载进度百分比（总量未知时为 0） */
  const percent = computed(() => {
    const total = progress.value.total;
    if (!total) return 0;
    return Math.min(100, Math.max(0, Math.round((progress.value.downloaded / total) * 100)));
  });

  function installerKind(): InstallerKind | null {
    return info.value?.installer ?? null;
  }

  /** 读取当前版本号与平台信息（幂等） */
  async function init(): Promise<void> {
    if (ready.value) return;
    const [version, platformInfo] = await Promise.all([
      getVersion().catch(() => ""),
      fetchPlatformInfo().catch(() => null),
    ]);
    currentVersion.value = version;
    platform.value = platformInfo;
    ready.value = true;
  }

  /**
   * 检查更新。
   * @param silent 静默检查（启动时自动触发的场景）：失败只写状态不弹提示
   */
  async function check(options: { silent?: boolean } = {}): Promise<void> {
    const silent = options.silent ?? false;
    if (phase.value === "checking" || phase.value === "downloading" || phase.value === "installing") {
      return;
    }

    await init();
    if (!canAutoUpdate.value) {
      if (!silent) toast(t("errors.generic.update.unsupportedPlatform"), "info");
      return;
    }

    phase.value = "checking";
    error.value = null;
    try {
      const result = await checkForUpdate(
        currentVersion.value || "0.0.0",
        settings.updateIncludePrerelease,
        settings.githubMirror,
      );
      await settings.setLastUpdateCheckAt(Date.now());
      info.value = result.update;
      unsupportedVersion.value = result.unsupportedVersion;

      if (result.update) {
        phase.value = "available";
        // 自动检查时尊重「忽略此版本」
        if (silent && settings.ignoredUpdateVersion === result.update.version) return;
        dialog.value = "prompt";
        return;
      }

      phase.value = "idle";
      if (result.unsupportedVersion) {
        if (!silent) {
          const target = platform.value
            ? `${platform.value.platform}-${platform.value.arch}`
            : t("errors.generic.update.platformFallback");
          toast(
            t("errors.generic.update.noAssetForPlatform", {
              version: result.unsupportedVersion,
              target,
            }),
            "info",
          );
        }
        return;
      }
      if (!silent)
        toast(
          t("errors.generic.update.upToDate", { version: currentVersion.value }).trim(),
          "success",
        );
    } catch (e) {
      phase.value = "error";
      error.value = e instanceof Error ? e.message : String(e);
      if (!silent) toast(error.value, "error");
    }
  }

  /** 启动时的自动检查（受「自动检查更新」开关与频率设置约束） */
  async function maybeAutoCheck(): Promise<void> {
    if (!settings.autoCheckUpdate) return;
    if (settings.updateCheckFrequency === "manual") return;
    if (
      settings.updateCheckFrequency === "daily" &&
      Date.now() - settings.lastUpdateCheckAt < DAILY_INTERVAL_MS
    ) {
      return;
    }
    await check({ silent: true });
  }

  /** 下载安装包并启动安装（桌面端安装开始时应用会自动退出） */
  async function startDownloadAndInstall(): Promise<void> {
    const target = info.value;
    if (!target) return;
    if (phase.value === "downloading" || phase.value === "installing") return;

    error.value = null;
    progress.value = { downloaded: 0, total: target.assetSize, speed: 0 };
    phase.value = "downloading";
    dialog.value = "progress";

    try {
      if (!stopProgress) {
        stopProgress = await onUpdateProgress((payload) => {
          progress.value = payload;
        });
      }

      const result = await downloadUpdate(target.assetUrl, target.assetName, target.assetSize);
      phase.value = "installing";
      await installUpdate(result.path, target.installer);
      phase.value = "done";
      dialog.value = "none";
      // 桌面端此时会自动退出应用、由安装程序接管；Android 交由系统安装界面
      if (target.installer === "android-apk") {
        toast(t("errors.generic.update.installStarted"), "success");
      }
    } catch (e) {
      dialog.value = "none";
      if (isCanceledError(e)) {
        phase.value = "idle";
        error.value = null;
        toast(t("errors.generic.update.canceled"), "info");
      } else {
        phase.value = "error";
        error.value = e instanceof Error ? e.message : String(e);
        toast(error.value, "error");
      }
    }
  }

  /** 取消下载（弹窗中的「取消下载」） */
  async function cancelDownload(): Promise<void> {
    if (phase.value === "downloading") {
      await cancelUpdateDownload().catch(() => {});
    }
    dialog.value = "none";
  }

  /** 忽略当前发现的版本：自动检查时不再提示 */
  async function ignoreCurrentVersion(): Promise<void> {
    const target = info.value;
    dialog.value = "none";
    if (!target) return;
    await settings.setIgnoredUpdateVersion(target.version);
    toast(t("errors.generic.update.versionIgnored", { version: target.version }), "info");
  }

  /** 重新打开「发现新版本」弹窗（关于页「查看更新」） */
  function openPrompt(): void {
    if (phase.value === "downloading" || phase.value === "installing") {
      dialog.value = "progress";
      return;
    }
    if (hasUpdate.value) dialog.value = "prompt";
    else void check();
  }

  function closeDialog(): void {
    dialog.value = "none";
  }

  /** 重置为未检查状态（忽略版本后想重新检查时使用） */
  async function forgetIgnoredVersion(): Promise<void> {
    await settings.setIgnoredUpdateVersion("");
  }

  function dispose(): void {
    stopProgress?.();
    stopProgress = null;
  }

  return {
    phase,
    dialog,
    info,
    unsupportedVersion,
    error,
    progress,
    currentVersion,
    platform,
    ready,
    hasUpdate,
    canAutoUpdate,
    ignoredVersion,
    percent,
    installerKind,
    init,
    check,
    maybeAutoCheck,
    startDownloadAndInstall,
    cancelDownload,
    ignoreCurrentVersion,
    openPrompt,
    closeDialog,
    forgetIgnoredVersion,
    dispose,
  };
});
