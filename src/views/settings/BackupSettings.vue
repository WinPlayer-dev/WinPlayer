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
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";
import { toast } from "@/services/toast";
import {
  BACKUP_VERSION,
  collectBackup,
  describeImport,
  runExport,
  runImport,
  type ImportSummary,
} from "@/services/backup";

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
  if (countsLoading.value || !counts.value) return "设置、本地曲库与播放队列";
  return `设置、${counts.value.playlists} 个歌单、${counts.value.liked} 首喜欢的音乐、${counts.value.offline} 条离线索引与播放队列`;
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
  toast("曲库与队列已更新，重新打开相关页面即可看到", "info");
}
</script>

<template>
  <div>
    <section class="settings-section">
      <h2 class="settings-section-title">备份与还原</h2>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">导出备份</div>
          <div class="card-description">
            把{{ scopeText }}写成一个 JSON 文件（格式版本 {{ BACKUP_VERSION }}）。离线音乐只备份索引，
            音频文件本身不会打包——换机后需要重新下载，原路径失效的条目会在离线页标记为失效。
          </div>
        </div>
        <WpButton variant="standard" class="small" :disabled="busy !== null" @click="doExport">
          {{ busy === "export" ? "导出中…" : "导出备份" }}
        </WpButton>
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">包含插件登录凭证</div>
          <div class="card-description">
            勾选后会把各插件的 Cookie / Token 一并写入备份文件。备份文件是明文 JSON，
            分享给别人前请确认已取消勾选。
          </div>
        </div>
        <ToggleSwitch :IsOn="includeCredentials" @Toggled="onCredentialsToggle" />
      </WpCard>

      <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">导入备份</div>
          <div class="card-description">
            按名称合并歌单、按曲目去重写入喜欢与离线索引；导入不会删除你现在已有的任何内容，
            同一份备份重复导入也不会产生重复数据。
          </div>
        </div>
        <WpButton variant="standard" class="small" :disabled="busy !== null" @click="doImport">
          {{ busy === "import" ? "导入中…" : "选择文件导入" }}
        </WpButton>
      </WpCard>
    </section>

    <ContentDialog
      ref="confirmDialogRef"
      Title="导入备份"
      Content="导入会向当前曲库合并备份里的歌单与曲目，并覆盖同名的设置项。现有内容不会被删除。确定继续吗？"
      PrimaryButtonText="开始导入"
      CloseButtonText="取消"
    />

    <ContentDialog
      ref="summaryDialogRef"
      Title="导入完成"
      :Content="summaryText"
      PrimaryButtonText="知道了"
      DefaultButton="Primary"
    />
  </div>
</template>

<style scoped>
.small {
  height: 28px;
  font-size: 12px;
  padding: 0 12px;
  flex: none;
}
</style>
