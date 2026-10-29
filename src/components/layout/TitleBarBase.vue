<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { PersonPicture } from "@/components/winui";
import CachedImage from "@/components/common/CachedImage.vue";
import { pluginDisplayName, usePluginsStore, type AppAvatar } from "@/stores/plugins";
import { useSettingsStore } from "@/stores/settings";

const router = useRouter();
const appWindow = getCurrentWindow();
const plugins = usePluginsStore();
const settingsStore = useSettingsStore();

const query = ref("");
const maximized = ref(false);

/** 插件提供的头像（能力：avatar），为空时回退默认占位头像 */
const avatar = ref<AppAvatar | null>(null);

const avatarUrl = computed(() => avatar.value?.image ?? "");
const avatarTitle = computed(() => {
  if (!avatar.value) return "账户";
  const name = pluginDisplayName(plugins.records, avatar.value.sourceId);
  const label = avatar.value.label?.trim();
  return [label, name].filter(Boolean).join(" · ") || "账户";
});

async function loadAvatar() {
  try {
    avatar.value = await plugins.getAvatar();
  } catch {
    avatar.value = null;
  }
}

/** 插件安装/启停/配置变化后重新取头像（配置变更会重建沙箱）；头像源设置变化同样刷新 */
watch(
  () => plugins.records,
  () => void loadAvatar(),
  { deep: true },
);

watch(
  () => settingsStore.avatarSourceId,
  () => void loadAvatar(),
);

let unlistenResize: UnlistenFn | null = null;

async function toggleMaximize() {
  await appWindow.toggleMaximize();
}

onMounted(async () => {
  void loadAvatar();
  unlistenResize = await appWindow.onResized(() => {
    void appWindow.isMaximized().then((value) => {
      maximized.value = value;
    });
  });
  maximized.value = await appWindow.isMaximized();
});

onUnmounted(() => {
  unlistenResize?.();
});

function submitSearch() {
  const keyword = query.value.trim();
  if (!keyword) return;
  void router.push({ path: "/search", query: { q: keyword } });
}
</script>

<template>
  <header class="titlebar">
    <!-- 拖拽区域 -->
    <div class="drag-region" data-tauri-drag-region />

    <div class="titlebar-left" data-tauri-drag-region>
      <div class="logo">
        <span class="logo-mark">
          <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="none" version="1.1" width="385.4658203125" height="390.3873291015625" viewBox="0 0 385.4658203125 390.3873291015625"><path d="M385.4658508300781 281.2491149902344C385.4658508300781 270.7557047434493 393.97244058329306 262.2491149902344 404.4658508300781 262.2491149902344L611.3434600830078 262.2491149902344C621.8368703297929 262.2491149902344 630.3434600830078 270.7557047434493 630.3434600830078 281.2491149902344L630.3434600830078 289.9457473754883C630.3434600830078 300.43915762227334 621.8368703297929 308.9457473754883 611.3434600830078 308.9457473754883L404.4658508300781 308.9457473754883C393.97244058329306 308.9457473754883 385.4658508300781 300.43915762227334 385.4658508300781 289.9457473754883Z" fill="currentColor" fill-opacity="1" transform="matrix(-0.866025447845459,0.4999999701976776,-0.4999999701976776,-0.866025447845459,850.4136366038119,296.63060831946586)"/><g><path d="M340.5228905175781,187.47639948242187C338.0193505175781,181.84398948242188,330.5669905175781,177.52599948242187,311.34470051757813,166.38836948242187L49.964080517578125,14.941169482421875C30.666625517578126,3.759986882421875,23.179595517578125,-0.578086857578125,17.034423517578126,0.061077117421875C11.674468517578125,0.618568422421875,6.803375217578125,3.425876582421875,3.633850117578125,7.784091982421875C1.2499999950052465e-13,12.780792482421875,1.2499999950052465e-13,21.433792482421875,1.2499999950052465e-13,43.73649548242187L1.2499999950052465e-13,346.65084948242185C1.2499999950052465e-13,368.9535194824219,1.2499999950052465e-13,377.60653948242185,3.633850117578125,382.6032394824219C6.803344717578125,386.9614594824219,11.674468517578125,389.7687694824219,17.034423517578126,390.32625948242185C23.179595517578125,390.96541948242185,30.666625517578126,386.6273494824219,49.964080517578125,375.44616948242185L311.34470051757813,223.99895948242187C330.5669905175781,212.86132948242187,338.0193505175781,208.54333948242189,340.5228905175781,202.91092948242186C342.7067005175781,197.99782948242188,342.7067005175781,192.38949948242188,340.5228905175781,187.47639948242187ZM111.06860051757812,137.99996948242188L57.000030517578125,137.99996948242188L57.000030517578125,192.06853948242187L111.06860051757812,192.06853948242187L111.06860051757812,137.99996948242188ZM171.00003051757812,137.99996948242188L116.93146051757813,137.99996948242188L116.93146051757813,192.06853948242187L171.00003051757812,192.06853948242187L171.00003051757812,137.99996948242188ZM111.06860051757812,197.93139948242188L57.000030517578125,197.93139948242188L57.000030517578125,251.99996948242188L111.06860051757812,251.99996948242188L111.06860051757812,197.93139948242188ZM171.00003051757812,197.93139948242188L116.93146051757813,197.93139948242188L116.93146051757813,251.99996948242188L171.00003051757812,251.99996948242188L171.00003051757812,197.93139948242188Z" fill-rule="evenodd" fill="currentColor" fill-opacity="1"/></g></svg>
        </span>
        <span class="logo-text">WinPlayer</span>
      </div>
    </div>

    <div class="titlebar-center">
      <div class="search-box">
        <span class="wp-icon search-icon">&#xF690;</span>
        <input
          v-model="query"
          class="search-input"
          type="text"
          placeholder="搜索音乐、歌单"
          @keydown.enter="submitSearch"
        />
      </div>
    </div>

    <div class="titlebar-right">
      <div class="avatar-wrap">
        <button class="avatar-button" :title="avatarTitle">
          <CachedImage v-if="avatarUrl" class="avatar-image" :src="avatarUrl" />
          <PersonPicture v-else DisplayName="音" :Width="28" :Height="28" FontSize="12" />
        </button>
      </div>

      <div class="caption-buttons">
        <button class="caption-button" title="最小化" @click="appWindow.minimize()">
          <span class="wp-icon">&#xEBCF;</span>
        </button>
        <button class="caption-button" :title="maximized ? '还原' : '最大化'" @click="toggleMaximize">
          <span class="wp-icon">{{ maximized ? "&#xEB95;" : "&#xF533;" }}</span>
        </button>
        <button class="caption-button close" title="关闭" @click="appWindow.close()">
          <span class="wp-icon">&#xF368;</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--wp-base);
  border-bottom: 1px solid var(--wp-divider);
}

.drag-region {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.titlebar-left {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  padding-left: var(--space-xl);
  min-width: 200px;
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.logo-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 6px;
  color: var(--wp-text-primary);
}

.logo-text {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.titlebar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  width: min(520px, 42%);
}

.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 32px;
  padding: 0 var(--space-md);
  background: var(--wp-control-fill);
  border: 1px solid transparent;
  border-bottom-color: var(--wp-control-stroke-secondary);
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-standard);
}

.search-box:hover {
  background: var(--wp-card-hover);
}

.search-box:focus-within {
  background: var(--wp-layer-solid);
  border-bottom: 2px solid var(--wp-accent);
}

.search-icon {
  font-size: 13px;
  color: var(--wp-text-secondary);
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--wp-text-primary);
  font-size: 13px;
  font-family: inherit;
  user-select: text;
}

.search-input::placeholder {
  color: var(--wp-text-secondary);
}

.titlebar-right {
  position: relative;
  z-index: 1;
  margin-left: auto;
  display: flex;
  align-items: stretch;
  height: 100%;
}

.avatar-wrap {
  display: flex;
  align-items: center;
  padding: 0 var(--space-md);
}

.avatar-button {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  border-radius: 50%;
}

.avatar-image {
  display: block;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--wp-control-fill);
}

.caption-buttons {
  display: flex;
}

.caption-button {
  width: 46px;
  border: none;
  background: transparent;
  color: var(--wp-text-primary);
  font-size: 11px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.caption-button:hover {
  background: var(--wp-card-hover);
}

.caption-button:active {
  background: var(--wp-card-active);
}

.caption-button.close:hover {
  background: #c42b1c;
  color: #ffffff;
}

.caption-button.close:active {
  background: #b22a1d;
}
</style>
