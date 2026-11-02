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
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";
import { useCloudStore } from "@/stores/cloud";
import { lastSyncAt, resetSyncState, runSync, syncState } from "@/services/cloudSync";
import { toast } from "@/services/toast";

const cloud = useCloudStore();

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
  syncAt.value ? new Date(syncAt.value).toLocaleString() : "尚未同步",
);

async function probe(): Promise<void> {
  busy.value = "probe";
  try {
    const info = await cloud.loadServerInfo(urlInput.value);
    if (info.needsFirstUser) {
      toast("这台服务器还没有账号，注册的第一个用户会成为管理员", "info");
      mode.value = "register";
    } else {
      toast(`已连接：${info.name}`, "success");
    }
  } catch (error) {
    toast(`连接失败：${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    busy.value = "";
  }
}

async function submit(): Promise<void> {
  if (!urlInput.value.trim()) {
    toast("请先填写服务器地址", "error");
    return;
  }
  if (!usernameInput.value.trim() || passwordInput.value.length < 6) {
    toast("用户名不能为空，密码至少 6 位", "error");
    return;
  }
  busy.value = mode.value;
  try {
    if (mode.value === "login") {
      await cloud.login(urlInput.value, usernameInput.value, passwordInput.value);
      toast("登录成功", "success");
    } else {
      await cloud.register(urlInput.value, usernameInput.value, passwordInput.value, inviteInput.value);
      toast("注册成功，已自动登录", "success");
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
  toast("已退出同频服务器", "info");
}

/** 选本地文件上传（初始化曲库最省事的路径） */
async function pickUpload(): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    title: "选择要上传到同频服务器的音频",
    multiple: true,
    directory: false,
    filters: [{ name: "音频", extensions: ["mp3", "flac", "m4a", "aac", "ogg", "wav"] }],
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
      toast(`${filename}: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
  busy.value = "";
  if (ok) {
    toast(`已上传 ${ok} 首`, "success");
    await cloud.refresh();
  }
}

async function doRefresh(): Promise<void> {
  busy.value = "refresh";
  try {
    await cloud.refresh();
    toast(`曲库已更新：${cloud.trackCount} 首`, "success");
  } finally {
    busy.value = "";
  }
}

async function doSync(): Promise<void> {
  busy.value = "sync";
  try {
    const result = await runSync();
    if (!result) {
      toast("同步未执行（未登录或未配置服务器）", "error");
      return;
    }
    summary.value = `推送 ${result.pushed} 条 · 拉取 ${result.pulled} 条`;
    syncAt.value = result.at;
    toast("同步完成", "success");
  } catch (error) {
    toast(`同步失败：${error instanceof Error ? error.message : String(error)}`, "error");
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
  toast("同步状态已重置，下次同步会重新合并", "info");
}

function progressText(item: { transferred: number; total: number }): string {
  if (!item.total) return "准备中…";
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
    summary.value = `推送 ${last.pushed} 条 · 拉取 ${last.pulled} 条`;
  }
});
</script>

<template>
  <section class="settings-section">
    <h2 class="settings-section-title">同步（温韵同频）</h2>

    <!-- 服务器 -->
    <WpCard class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">服务器地址</div>
        <div class="card-description">
          填你自建服务器（Docker 部署后就是 <code>http://IP:3456</code>）。
          地址存在本机，换服务器只需改这里重新登录。
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
          {{ busy === "probe" ? "检测中…" : "检测连接" }}
        </WpButton>
      </div>
      <div v-if="cloud.serverInfo" class="cloud-hint">
        已连接 <strong>{{ cloud.serverInfo.name }}</strong>
        · 注册{{ registeredOpen ? "开放" : "关闭" }}
        <span v-if="needsInvite">· 需要邀请码</span>
      </div>
    </WpCard>

    <!-- 账号 -->
    <WpCard class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">{{ cloud.configured ? "账号" : mode === "login" ? "登录" : "注册" }}</div>
        <div class="card-description">
          <template v-if="cloud.configured">
            {{ account?.username ?? cloud.config.username }}
            <span v-if="account?.role === 'admin'"> · 管理员</span>
          </template>
          <template v-else>
            同一个账号在多台设备登录后，喜欢、歌单、播放历史与歌曲自定义信息会互相同步。
          </template>
        </div>
      </div>

      <template v-if="cloud.configured">
        <div class="cloud-row">
          <WpButton variant="standard" size="small" :disabled="busy !== ''" @click="doLogout">
            退出登录
          </WpButton>
        </div>
      </template>

      <template v-else>
        <div class="cloud-row">
          <TextBox
            class="cloud-input"
            :Text="usernameInput"
            PlaceholderText="用户名"
            @update:Text="usernameInput = String($event ?? '')"
          />
        </div>
        <div class="cloud-row">
          <TextBox
            class="cloud-input"
            :Text="passwordInput"
            PlaceholderText="密码（至少 6 位）"
            InputType="password"
            @update:Text="passwordInput = String($event ?? '')"
          />
        </div>
        <div v-if="mode === 'register' && needsInvite" class="cloud-row">
          <TextBox
            class="cloud-input"
            :Text="inviteInput"
            PlaceholderText="邀请码"
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
            {{ busy === "login" || busy === "register" ? "处理中…" : mode === "login" ? "登录" : "注册" }}
          </WpButton>
          <WpButton
            variant="standard"
            size="small"
            :disabled="busy !== ''"
            @click="mode = mode === 'login' ? 'register' : 'login'"
          >
            {{ mode === "login" ? "去注册" : "去登录" }}
          </WpButton>
        </div>
        <div v-if="mode === 'register' && !registeredOpen && !cloud.serverInfo?.needsFirstUser" class="cloud-hint">
          这台服务器没有开放注册，需要管理员在后台建号或打开注册开关。
        </div>
      </template>
    </WpCard>

    <!-- 曲库 -->
    <WpCard v-if="cloud.configured" class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">曲库</div>
        <div class="card-description">
          {{ cloud.trackCount }} 首 · {{ cloud.albumCount }} 张专辑 · 已用 {{ usedText }}
        </div>
      </div>
      <div class="cloud-row">
        <WpButton variant="accent" size="small" :disabled="busy !== ''" @click="pickUpload">
          {{ busy === "upload" ? "上传中…" : "上传本地文件" }}
        </WpButton>
        <WpButton variant="standard" size="small" :disabled="busy !== ''" @click="doRefresh">
          {{ busy === "refresh" ? "刷新中…" : "刷新曲库" }}
        </WpButton>
      </div>
      <div v-if="cloud.uploads.length" class="cloud-uploads">
        <div v-for="item in cloud.uploads.slice(0, 4)" :key="item.taskId" class="cloud-upload-item">
          <span class="ellipsis">{{ item.filename }}</span>
          <span class="cloud-upload-state">
            <template v-if="item.phase === 'done'">完成</template>
            <template v-else-if="item.phase === 'failed'">失败</template>
            <template v-else-if="item.phase === 'downloading'">拉取音频 {{ progressText(item) }}</template>
            <template v-else>上传中 {{ progressText(item) }}</template>
          </span>
        </div>
      </div>
    </WpCard>

    <!-- 同步 -->
    <WpCard v-if="cloud.configured" class="settings-card column cloud-card">
      <div class="card-content">
        <div class="card-header">账号数据同步</div>
        <div class="card-description">
          同步喜欢、歌单（含顺序）、播放历史与歌曲自定义信息。上次同步：{{ syncTimeText }}
          <span v-if="summary"> · {{ summary }}</span>
        </div>
      </div>
      <div class="cloud-row">
        <WpButton variant="accent" size="small" :disabled="busy !== ''" @click="doSync">
          {{ busy === "sync" ? "同步中…" : "立即同步" }}
        </WpButton>
        <WpButton variant="standard" size="small" :disabled="busy !== ''" @click="doReset">
          重置同步状态
        </WpButton>
      </div>
      <div class="cloud-hint">
        登录后自动同步每 2 分钟跑一次；「重置同步状态」只清本机的同步游标与快照，
        不会删除任何音乐或云端数据。
      </div>
    </WpCard>

    <ContentDialog
      ref="confirmDialogRef"
      Title="重置同步状态"
      PrimaryButtonText="reset"
      CloseButtonText="取消"
    >
      <p style="margin: 0">
        本机的同步游标与快照会被清空，下次同步会重新做一次全量合并（并集 + 服务器较新者胜）。
        你的喜欢、歌单与云端曲库都不会被删除。
      </p>
    </ContentDialog>
  </section>
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
