<script setup lang="ts">
/**
 * 设置页「备份与还原」分类。
 *
 * 导出一份自描述的 JSON（设置 + 本地曲库 + 播放队列），换机或重装后导入即可
 * 恢复。默认不包含插件登录凭证（Cookie / Token），需要时手动勾选——避免把
 * 账号凭证随手发给别人。
 */
import { computed, ref } from "vue";
import { ContentDialog, ToggleSwitch } from "@/components/winui";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";
import { toast } from "@/services/toast";
import {
  collectBackup,
  describeImport,
  runExport,
  runImport,
  type ImportSummary,
} from "@/services/backup";

const { t } = useI18n();

/** 是否包含插件登录凭证 */
const includeCredentials = ref(false);

/** 导出中 / 导入中：避免重复点击 */
const busy = ref<"export" | "import" | null>(null);

/** 导入前的确认对话框 */
interface DialogRef {
  ShowAsync: () => Promise<string>;
}
const confirmDialogRef = ref<DialogRef | null>(null);
/** 导入完成后的结果摘要（弹窗展示） */
const summaryText = ref("");
const summaryDialogRef = ref<DialogRef | null>(null);

/** 预览：当前库里大概会导出多少东西（点击「导出」前顺手展示，让用户有数） */
const counts = ref<{ playlists: number; liked: number; offline: number } | null>(null);
const countsLoading = ref(false);

async function loadCounts(): Promise<void> {
  countsLoading.value = true;
  try {
    const payload = await collectBackup({ includeCredentials: includeCredentials.value });
    counts.value = {
      playlists: payload.playlists?.length ?? 0,
      liked: payload.likedSongs?.length ?? 0,
      offline: payload.offlineSongs?.length ?? 0,
    };
  } catch {
    counts.value = null;
  } finally {
    countsLoading.value = false;
  }
}

void loadCounts();

const scopeText = computed(() => {
  if (countsLoading.value || !counts.value) return t("settings.data.backup.export.scopeFallback");
  return t("settings.data.backup.export.scope", {
    playlists: counts.value.playlists,
    liked: counts.value.liked,
    offline: counts.value.offline,
  });
});

function onCredentialsToggle(event: { IsOn: boolean }): void {
  includeCredentials.value = Boolean(event?.IsOn);
  void loadCounts();
}

async function doExport(): Promise<void> {
  if (busy.value) return;
  busy.value = "export";
  try {
    await runExport({ includeCredentials: includeCredentials.value });
  } finally {
    busy.value = null;
  }
}

async function doImport(): Promise<void> {
  if (busy.value) return;
  const confirmed = await confirmDialogRef.value?.ShowAsync();
  if (confirmed !== "Primary") return;
  busy.value = "import";
  try {
    const summary: ImportSummary | null = await runImport();
    if (!summary) return;
    summaryText.value = describeImport(summary);
    await summaryDialogRef.value?.ShowAsync();
    // 导入会改动曲库与队列：提示用户重新进入相关页面才能看到最新内容
    notifyReload();
    void loadCounts();
  } finally {
    busy.value = null;
  }
}

/** 导入后提示需要刷新才能看到的变化 */
function notifyReload(): void {
  toast(t("settings.data.backup.import.reloaded"), "info");
}
</script>

<template>
  <SettingsSection id="data-backup" :title="t('settings.data.backup.section')">
      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.data.backup.export.title") }}</div>
          <div class="card-description">
            {{ t("settings.data.backup.export.description", { scope: scopeText }) }}
          </div>
        </div>
        <WpButton variant="standard" class="small" :disabled="busy !== null" @click="doExport">
          {{ busy === "export" ? t("settings.data.backup.export.busy") : t("settings.data.backup.export.action") }}
        </WpButton>
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.data.backup.credentials.title") }}</div>
          <div class="card-description">
            {{ t("settings.data.backup.credentials.description") }}
          </div>
        </div>
        <ToggleSwitch :IsOn="includeCredentials" @Toggled="onCredentialsToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.data.backup.import.title") }}</div>
          <div class="card-description">
            {{ t("settings.data.backup.import.description") }}
          </div>
        </div>
        <WpButton variant="standard" class="small" :disabled="busy !== null" @click="doImport">
          {{ busy === "import" ? t("settings.data.backup.import.busy") : t("settings.data.backup.import.action") }}
        </WpButton>
      </WpCard>
    <ContentDialog
      ref="confirmDialogRef"
      :Title="t('settings.data.backup.import.title')"
      :Content="t('settings.data.backup.import.confirmContent')"
      :PrimaryButtonText="t('settings.data.backup.import.confirmPrimary')"
      :CloseButtonText="t('common.action.cancel')"
    />

    <ContentDialog
      ref="summaryDialogRef"
      :Title="t('settings.data.backup.import.doneTitle')"
      :Content="summaryText"
      :PrimaryButtonText="t('settings.data.backup.import.donePrimary')"
      DefaultButton="Primary"
    />
  </SettingsSection>
</template>

<style scoped>
.small {
  height: 28px;
  font-size: 12px;
  padding: 0 12px;
  flex: none;
}
</style>
