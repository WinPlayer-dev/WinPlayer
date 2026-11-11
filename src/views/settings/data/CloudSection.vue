<script setup lang="ts">
/**
 * 设置页「同步」分类。
 *
 * 一个页面装完三件事，因为它们属于同一个账号：
 * 1. 连接与登录（服务器地址自己填、可注册可邀请码）；
 * 2. 曲库（统计 / 手动刷新 / 从本机上传）；
 * 3. 账号数据同步（手动同步、结果、重置）。
 *
 * 登录成功后同步不会自动开始 —— 用户按「立即同步」才跑第一次，避免一登录就把
 * 几千条数据推上去；之后由 2 分钟一次的后台自动同步接手。
 */
import { computed, onMounted, ref } from "vue";
import { ContentDialog, TextBox } from "@/components/winui";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";
import { useCloudStore } from "@/stores/cloud";
import { lastSyncAt, resetSyncState, runSync, syncState } from "@/services/cloudSync";
import { toast } from "@/services/toast";
import { useI18n } from "@/i18n";

const cloud = useCloudStore();
const { t } = useI18n();

const urlInput = ref("");
const usernameInput = ref("");
const passwordInput = ref("");
const inviteInput = ref("");
const mode = ref<"login" | "register">("login");
const busy = ref("");
const syncAt = ref(0);
const summary = ref("");

const account = ref<{ username: string; role: string } | null>(null);

const registeredOpen = computed(() => cloud.serverInfo?.registrationOpen ?? false);
const needsInvite = computed(() => cloud.serverInfo?.inviteRequired ?? false);

const usedText = computed(() => {
  const used = cloud.usedBytes;
  const quota = cloud.quotaBytes;
  const mb = (value: number) => `${(value / 1024 / 1024).toFixed(value > 1024 * 1024 * 1024 ? 0 : 1)} MB`;
  return quota > 0 ? `${mb(used)} / ${mb(quota)}` : mb(used);
});

const syncTimeText = computed(() =>
  syncAt.value ? new Date(syncAt.value).toLocaleString() : t("settings.data.cloud.sync.never"),
);

async function probe(): Promise<void> {
  busy.value = "probe";
  try {
    const info = await cloud.loadServerInfo(urlInput.value);
    if (info.needsFirstUser) {
      toast(t("settings.data.cloud.server.firstUser"), "info");
      mode.value = "register";
    } else {
      toast(t("settings.data.cloud.server.probeConnected", { name: info.name }), "success");
    }
  } catch (error) {
    toast(
      t("settings.data.cloud.server.probeFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    busy.value = "";
  }
}

async function submit(): Promise<void> {
  if (!urlInput.value.trim()) {
    toast(t("settings.data.cloud.account.urlRequired"), "error");
    return;
  }
  if (!usernameInput.value.trim() || passwordInput.value.length < 6) {
    toast(t("settings.data.cloud.account.invalidInput"), "error");
    return;
  }
  busy.value = mode.value;
  try {
    if (mode.value === "login") {
      await cloud.login(urlInput.value, usernameInput.value, passwordInput.value);
      toast(t("settings.data.cloud.account.loginSuccess"), "success");
    } else {
      await cloud.register(urlInput.value, usernameInput.value, passwordInput.value, inviteInput.value);
      toast(t("settings.data.cloud.account.registerSuccess"), "success");
    }
    passwordInput.value = "";
    inviteInput.value = "";
    await refreshAccount();
    syncAt.value = await lastSyncAt();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy.value = "";
  }
}

async function refreshAccount(): Promise<void> {
  account.value = cloud.configured ? await cloud.me() : null;
}

async function doLogout(): Promise<void> {
  await cloud.logout();
  account.value = null;
  summary.value = "";
  syncAt.value = 0;
  toast(t("settings.data.cloud.account.loggedOut"), "info");
}

/** 选本地文件上传（初始化曲库最省事的路径） */
async function pickUpload(): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    title: t("settings.data.cloud.library.uploadDialogTitle"),
    multiple: true,
    directory: false,
    filters: [
      {
        name: t("settings.data.cloud.library.audioFilter"),
        extensions: ["mp3", "flac", "m4a", "aac", "ogg", "wav"],
      },
    ],
  });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (!paths.length) return;

  busy.value = "upload";
  let ok = 0;
  for (const path of paths) {
    const filename = path.split(/[\\/]/).pop() ?? "upload.mp3";
    try {
      await cloud.upload({ filename, source: { kind: "path", path } });
      ok += 1;
    } catch (error) {
      toast(
        t("settings.data.cloud.library.uploadFailed", {
          filename,
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    }
  }
  busy.value = "";
  if (ok) {
    toast(t("settings.data.cloud.library.uploadDone", { count: ok }), "success");
    await cloud.refresh();
  }
}

async function doRefresh(): Promise<void> {
  busy.value = "refresh";
  try {
    await cloud.refresh();
    toast(t("settings.data.cloud.library.refreshed", { count: cloud.trackCount }), "success");
  } finally {
    busy.value = "";
  }
}

async function doSync(): Promise<void> {
  busy.value = "sync";
  try {
    const result = await runSync();
    if (!result) {
      toast(t("settings.data.cloud.sync.notRun"), "error");
      return;
    }
    summary.value = t("settings.data.cloud.sync.summary", {
      pushed: result.pushed,
      pulled: result.pulled,
    });
    syncAt.value = result.at;
    toast(t("settings.data.cloud.sync.done"), "success");
  } catch (error) {
    toast(
      t("settings.data.cloud.sync.failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
      "error",
    );
  } finally {
    busy.value = "";
  }
}

interface DialogRef {
  ShowAsync: () => Promise<string>;
}
const confirmDialogRef = ref<DialogRef | null>(null);

async function doReset(): Promise<void> {
  const answer = await confirmDialogRef.value?.ShowAsync();
  if (answer !== "reset") return;
  await resetSyncState();
  syncAt.value = 0;
  summary.value = "";
  toast(t("settings.data.cloud.sync.resetDone"), "info");
}

function progressText(item: { transferred: number; total: number }): string {
  if (!item.total) return t("settings.data.cloud.library.preparing");
  return `${Math.min(100, Math.round((item.transferred / item.total) * 100))}%`;
}

onMounted(async () => {
  await cloud.load();
  urlInput.value = cloud.config.url;
  usernameInput.value = cloud.config.username;
  syncAt.value = await lastSyncAt();
  await refreshAccount();
  if (syncState().last) {
    const last = syncState().last!;
    summary.value = t("settings.data.cloud.sync.summary", {
      pushed: last.pushed,
      pulled: last.pulled,
    });
  }
});
</script>

<template>
  <SettingsSection id="data-cloud" :title="t('settings.data.cloud.section')">

    <!-- 服务器 -->
    <WpCard class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.cloud.server.title") }}</div>
        <div class="card-description">
          {{ t("settings.data.cloud.server.descriptionBefore") }}
          <code>http://IP:3456</code>{{ t("settings.data.cloud.server.descriptionAfter") }}
        </div>
      </div>
      <div class="cloud-row">
        <TextBox
          class="cloud-input"
          :Text="urlInput"
          PlaceholderText="http://192.168.1.10:3456"
          @update:Text="urlInput = String($event ?? '')"
        />
        <WpButton variant="standard" size="small" :disabled="busy === 'probe'" @click="probe">
          {{ busy === "probe" ? t("settings.data.cloud.server.probing") : t("settings.data.cloud.server.probe") }}
        </WpButton>
      </div>
      <div v-if="cloud.serverInfo" class="cloud-hint">
        {{ t("settings.data.cloud.server.connected") }} <strong>{{ cloud.serverInfo.name }}</strong>
        · {{ registeredOpen ? t("settings.data.cloud.server.registrationOpen") : t("settings.data.cloud.server.registrationClosed") }}
        <span v-if="needsInvite">· {{ t("settings.data.cloud.server.needsInvite") }}</span>
      </div>
    </WpCard>

    <!-- 账号 -->
    <WpCard class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">
          {{ cloud.configured ? t("settings.data.cloud.account.title") : mode === "login" ? t("settings.data.cloud.account.login") : t("settings.data.cloud.account.register") }}
        </div>
        <div class="card-description">
          <template v-if="cloud.configured">
            {{ account?.username ?? cloud.config.username }}
            <span v-if="account?.role === 'admin'"> · {{ t("settings.data.cloud.account.admin") }}</span>
          </template>
          <template v-else>
            {{ t("settings.data.cloud.account.description") }}
          </template>
        </div>
      </div>

      <template v-if="cloud.configured">
        <div class="cloud-row">
          <WpButton variant="standard" size="small" :disabled="busy !== ''" @click="doLogout">
            {{ t("settings.data.cloud.account.logout") }}
          </WpButton>
        </div>
      </template>

      <template v-else>
        <div class="cloud-row">
          <TextBox
            class="cloud-input"
            :Text="usernameInput"
            :PlaceholderText="t('settings.data.cloud.account.usernamePlaceholder')"
            @update:Text="usernameInput = String($event ?? '')"
          />
        </div>
        <div class="cloud-row">
          <TextBox
            class="cloud-input"
            :Text="passwordInput"
            :PlaceholderText="t('settings.data.cloud.account.passwordPlaceholder')"
            InputType="password"
            @update:Text="passwordInput = String($event ?? '')"
          />
        </div>
        <div v-if="mode === 'register' && needsInvite" class="cloud-row">
          <TextBox
            class="cloud-input"
            :Text="inviteInput"
            :PlaceholderText="t('settings.data.cloud.account.invitePlaceholder')"
            @update:Text="inviteInput = String($event ?? '')"
          />
        </div>
        <div class="cloud-row">
          <WpButton
            variant="accent"
            size="small"
            :disabled="busy === 'login' || busy === 'register'"
            @click="submit"
          >
            {{ busy === "login" || busy === "register" ? t("common.state.processing") : mode === "login" ? t("settings.data.cloud.account.login") : t("settings.data.cloud.account.register") }}
          </WpButton>
          <WpButton
            variant="standard"
            size="small"
            :disabled="busy !== ''"
            @click="mode = mode === 'login' ? 'register' : 'login'"
          >
            {{ mode === "login" ? t("settings.data.cloud.account.toRegister") : t("settings.data.cloud.account.toLogin") }}
          </WpButton>
        </div>
        <div v-if="mode === 'register' && !registeredOpen && !cloud.serverInfo?.needsFirstUser" class="cloud-hint">
          {{ t("settings.data.cloud.account.registrationClosed") }}
        </div>
      </template>
    </WpCard>

    <!-- 曲库 -->
    <WpCard v-if="cloud.configured" class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.cloud.library.title") }}</div>
        <div class="card-description">
          {{ t("settings.data.cloud.library.description", { tracks: cloud.trackCount, albums: cloud.albumCount, used: usedText }) }}
        </div>
      </div>
      <div class="cloud-row">
        <WpButton variant="accent" size="small" :disabled="busy !== ''" @click="pickUpload">
          {{ busy === "upload" ? t("settings.data.cloud.library.uploading") : t("settings.data.cloud.library.upload") }}
        </WpButton>
        <WpButton variant="standard" size="small" :disabled="busy !== ''" @click="doRefresh">
          {{ busy === "refresh" ? t("settings.data.cloud.library.refreshing") : t("settings.data.cloud.library.refresh") }}
        </WpButton>
      </div>
      <div v-if="cloud.uploads.length" class="cloud-uploads">
        <div v-for="item in cloud.uploads.slice(0, 4)" :key="item.taskId" class="cloud-upload-item">
          <span class="ellipsis">{{ item.filename }}</span>
          <span class="cloud-upload-state">
            <template v-if="item.phase === 'done'">{{ t("common.action.done") }}</template>
            <template v-else-if="item.phase === 'failed'">{{ t("common.state.failed") }}</template>
            <template v-else-if="item.phase === 'downloading'">{{ t("settings.data.cloud.library.fetchingProgress", { progress: progressText(item) }) }}</template>
            <template v-else>{{ t("settings.data.cloud.library.uploadingProgress", { progress: progressText(item) }) }}</template>
          </span>
        </div>
      </div>
    </WpCard>

    <!-- 同步 -->
    <WpCard v-if="cloud.configured" class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">{{ t("settings.data.cloud.sync.title") }}</div>
        <div class="card-description">
          {{ t("settings.data.cloud.sync.description", { time: syncTimeText }) }}
          <span v-if="summary"> · {{ summary }}</span>
        </div>
      </div>
      <div class="cloud-row">
        <WpButton variant="accent" size="small" :disabled="busy !== ''" @click="doSync">
          {{ busy === "sync" ? t("settings.data.cloud.sync.syncing") : t("settings.data.cloud.sync.action") }}
        </WpButton>
        <WpButton variant="standard" size="small" :disabled="busy !== ''" @click="doReset">
          {{ t("settings.data.cloud.sync.reset") }}
        </WpButton>
      </div>
      <div class="cloud-hint">
        {{ t("settings.data.cloud.sync.hint") }}
      </div>
    </WpCard>

    <ContentDialog
      ref="confirmDialogRef"
      :Title="t('settings.data.cloud.sync.resetConfirmTitle')"
      PrimaryButtonText="reset"
      :CloseButtonText="t('common.action.cancel')"
    >
      <p style="margin: 0">
        {{ t("settings.data.cloud.sync.resetConfirmContent") }}
      </p>
    </ContentDialog>
  </SettingsSection>
</template>

<style scoped>
.cloud-card {
  gap: 10px;
}

.cloud-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.cloud-input {
  flex: 1 1 220px;
  min-width: 0;
}

.cloud-hint {
  font-size: 12px;
  opacity: 0.75;
  line-height: 1.5;
}

.cloud-uploads {
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.cloud-upload-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  opacity: 0.85;
}

.cloud-upload-state {
  flex: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  opacity: 0.9;
}
</style>
