<script setup lang="ts">
/**
 * 分类内的分组导航（chips）。
 *
 * 分类合并后单页变长（「数据」有 4 组、「播放」有 5 组），只靠滚动会迷路。
 * 这里提供两件事：
 * 1. 顶部一行 chips，点了平滑滚到该分组；
 * 2. 滚动时高亮当前分组（scroll-spy），并让高亮的 chip 自动居中。
 *
 * 数据源是 settingsIndex.ts 的 SETTINGS_SECTIONS，与搜索索引、开发期漂移校验
 * 共用一份，所以 chips 与页面里真实存在的分组不会走偏。
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import type { SettingsSectionMeta } from "@/views/settings/settingsIndex";
import { sectionTitle } from "@/views/settings/settingsIndex";

const props = defineProps<{
  sections: SettingsSectionMeta[];
  /** 滚动容器（.wp-page），scroll-spy 必须监听它而不是 window */
  scrollRoot: HTMLElement | null;
}>();

const emit = defineEmits<{ pick: [id: string] }>();

const { t } = useI18n();

/** 判定「已经到了这一组」的容差：分组标题顶到 chips 下方再留一点缓冲 */
const ACTIVE_THRESHOLD = 24;

const trackRef = ref<HTMLElement | null>(null);
const activeId = ref("");

/**
 * 实际渲染出来的分组。
 *
 * 索引里的分组是全平台的，但面板里不少分组带 v-if（桌面专属的「桌面歌词」「输出设备」、
 * 移动专属的「触感反馈」、只在本机存在的「车载模式」）。不过滤的话手机上会多出点了
 * 没反应的空 chip，桌面端会多出「触感反馈」。
 */
const visible = ref<SettingsSectionMeta[]>(props.sections);

function refreshVisible(): void {
  const root = props.scrollRoot;
  if (!root) {
    visible.value = props.sections;
    return;
  }
  visible.value = props.sections.filter((section) =>
    root.querySelector(`[data-section-id="${section.id}"]`),
  );
}

function sectionElement(id: string): HTMLElement | null {
  return props.scrollRoot?.querySelector<HTMLElement>(`[data-section-id="${id}"]`) ?? null;
}

/** scroll-spy：取「顶部已越过阈值」的最后一组；没有则停在第一组 */
function updateActive(): void {
  const root = props.scrollRoot;
  if (!root || !visible.value.length) return;
  const anchor = root.getBoundingClientRect().top + ACTIVE_THRESHOLD;

  let current = visible.value[0].id;
  for (const section of visible.value) {
    const element = sectionElement(section.id);
    if (!element) continue;
    if (element.getBoundingClientRect().top - anchor <= 0) current = section.id;
  }
  if (current !== activeId.value) activeId.value = current;
}

let ticking = false;

function onScroll(): void {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    updateActive();
  });
}

function bindScroll(): void {
  unbindScroll();
  const root = props.scrollRoot;
  if (!root) return;
  root.addEventListener("scroll", onScroll, { passive: true });
  void nextTick(() => {
    // 首次挂载时还没测过 DOM：这里必须重新按真实存在的分组过滤一次，
    // 否则移动端会显示「桌面歌词」「输出设备」这种点不动的空 chip
    refreshVisible();
    updateActive();
  });
}

function unbindScroll(): void {
  props.scrollRoot?.removeEventListener("scroll", onScroll);
}

watch(() => props.scrollRoot, bindScroll, { immediate: true });

// 换分类时分组列表整体换了：先等面板渲染完，按 DOM 过滤出真实存在的分组再测位置
watch(
  () => props.sections,
  async () => {
    await nextTick();
    await nextTick();
    refreshVisible();
    activeId.value = visible.value[0]?.id ?? "";
    updateActive();
  },
  { deep: false, immediate: true },
);

// 高亮变化时把 chip 横向滚到可视区中间。
// 这里必须只滚 chips 自己的横向滚动条：用 scrollIntoView 会连带滚动页面，
// 还会打断 SettingsView 正在跑的纵向平滑滚动（实测表现为「点了标签完全没反应」）。
watch(activeId, async () => {
  await nextTick();
  const track = trackRef.value;
  const chip = track?.querySelector<HTMLElement>(".section-chip.active");
  if (!track || !chip) return;
  const target = chip.offsetLeft - (track.clientWidth - chip.clientWidth) / 2;
  track.scrollTo({ left: Math.max(0, target), behavior: "auto" });
});

onBeforeUnmount(unbindScroll);

function pick(id: string): void {
  emit("pick", id);
  // 先把高亮切过去，避免平滑滚动过程中 chips 来回跳
  activeId.value = id;
}
</script>

<template>
  <nav
    v-if="visible.length > 1"
    ref="trackRef"
    class="settings-chips"
    :aria-label="t('settings.shell.sectionNavLabel')"
  >
    <button
      v-for="section in visible"
      :key="section.id"
      type="button"
      class="section-chip"
      :class="{ active: section.id === activeId }"
      @click="pick(section.id)"
    >
      {{ sectionTitle(section) }}
    </button>
  </nav>
</template>
