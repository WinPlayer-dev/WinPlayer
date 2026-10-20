<script setup lang="ts">
/**
 * 睡眠定时器选择面板（桌面「更多」菜单与移动端「更多」面板共用）。
 *
 * 只渲染选项本体，外层容器（浮出菜单 / 贴底面板）由调用方提供：
 * - `tone="light"`：桌面浮出菜单，跟随主题色变量；
 * - `tone="dark"`：移动端全屏播放页的深色贴底面板。
 *
 * 选定后触发 `close`，调用方据此收起外层容器。
 */
import { computed, ref } from "vue";
import { NumberBox, TextBox } from "@/components/winui";
import { useSleepTimer } from "@/services/sleepTimer";
import { toast } from "@/services/toast";

const props = withDefaults(defineProps<{ tone?: "light" | "dark" }>(), { tone: "light" });

const emit = defineEmits<{ close: [] }>();

const { mode, remainingLabel, startMinutes, startAtClock, startAfterTrack, cancel } =
  useSleepTimer();

/** 快捷档位（分钟） */
const PRESETS = [15, 30, 45, 60, 90] as const;

const active = computed(() => mode.value !== "off");

/* ------------------------------ 自定义分钟 ------------------------------ */

const customMinutes = ref(30);

function applyCustomMinutes(): void {
  const value = Number(customMinutes.value);
  if (!Number.isFinite(value) || value < 1) {
    toast("请输入大于 0 的分钟数", "error");
    return;
  }
  startMinutes(value);
  toast(`将在 ${Math.round(value)} 分钟后停止播放`, "success");
  emit("close");
}

/* ------------------------------ 指定时刻 ------------------------------ */

/** 默认填下一个整点 */
function defaultClockText(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
}

const clockText = ref(defaultClockText());

/** 解析 HH:mm（也接受 H:mm 与全角冒号） */
function parseClock(text: string): { hour: number; minute: number } | null {
  const match = text.trim().replace(/：/g, ":").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const clockValid = computed(() => parseClock(clockText.value) !== null);

/** 输入的时刻是否落在明天（用于提示「明天 xx:xx 停止」） */
const clockIsTomorrow = computed(() => {
  const parsed = parseClock(clockText.value);
  if (!parsed) return false;
  const now = new Date();
  const target = new Date(now);
  target.setHours(parsed.hour, parsed.minute, 0, 0);
  return target.getTime() <= now.getTime();
});

function applyClock(): void {
  const parsed = parseClock(clockText.value);
  if (!parsed) {
    toast("时间格式应为 23:30", "error");
    return;
  }
  startAtClock(parsed.hour, parsed.minute);
  const label = `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
  toast(`将在${clockIsTomorrow.value ? " 明天 " : " "}${label} 停止播放`, "success");
  emit("close");
}

/* ------------------------------ 其他 ------------------------------ */

function pickPreset(minutes: number): void {
  startMinutes(minutes);
  toast(`将在 ${minutes} 分钟后停止播放`, "success");
  emit("close");
}

function applyAfterTrack(): void {
  startAfterTrack();
  toast("播完当前曲目后停止播放", "success");
  emit("close");
}

function clearTimer(): void {
  cancel();
  toast("已取消睡眠定时器", "info");
  emit("close");
}
</script>

<template>
  <div class="sleep-timer" :class="`tone-${props.tone}`">
    <p v-if="active" class="sleep-active">
      <template v-if="mode === 'after-track'">播完当前曲目后停止</template>
      <template v-else>剩余 {{ remainingLabel }} 后停止</template>
    </p>

    <div class="sleep-grid">
      <button
        v-for="minutes in PRESETS"
        :key="minutes"
        class="sleep-chip"
        @click="pickPreset(minutes)"
      >
        {{ minutes }} 分钟
      </button>
    </div>

    <div class="sleep-field">
      <NumberBox
        class="sleep-number"
        :Value="customMinutes"
        :Minimum="1"
        :Maximum="1440"
        :SmallChange="5"
        PlaceholderText="分钟"
        @update:Value="customMinutes = $event"
      />
      <button class="sleep-action" @click="applyCustomMinutes">分钟后停止</button>
    </div>

    <div class="sleep-field">
      <TextBox
        class="sleep-text"
        :Text="clockText"
        PlaceholderText="23:30"
        :MaxLength="5"
        @update:Text="clockText = String($event ?? '')"
      />
      <button class="sleep-action" :disabled="!clockValid" @click="applyClock">到点停止</button>
    </div>
    <p class="sleep-hint">
      {{ clockIsTomorrow ? "该时刻今天已过，将在明天停止" : "24 小时制，如 23:30" }}
    </p>

    <button class="sleep-row" @click="applyAfterTrack">播完当前曲目后停止</button>
    <button v-if="active" class="sleep-row sleep-cancel" @click="clearTimer">取消定时</button>
  </div>
</template>

<style scoped>
.sleep-timer {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 8px);
  padding: 4px 2px;
}

.sleep-active {
  margin: 0;
  font-size: 12px;
  color: var(--wp-accent);
  font-variant-numeric: tabular-nums;
}

.sleep-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.sleep-chip {
  height: 32px;
  border-radius: var(--radius-sm, 6px);
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background var(--duration-fast, 120ms) var(--ease-standard, ease);
}

.sleep-field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sleep-number,
.sleep-text {
  width: 96px;
  flex: none;
}

.sleep-action {
  flex: 1;
  min-width: 0;
  height: 32px;
  border-radius: var(--radius-sm, 6px);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sleep-action:disabled {
  opacity: 0.5;
  cursor: default;
}

.sleep-hint {
  margin: 0;
  font-size: 11px;
  opacity: 0.65;
}

.sleep-row {
  height: 32px;
  border-radius: var(--radius-sm, 6px);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  padding: 0 10px;
}

/* ---------- 桌面浮出菜单（跟随主题） ---------- */

.tone-light .sleep-chip,
.tone-light .sleep-action,
.tone-light .sleep-row {
  border: 1px solid var(--wp-control-stroke);
  background: var(--wp-control-fill-secondary);
  color: var(--wp-text-primary);
}

.tone-light .sleep-chip:hover,
.tone-light .sleep-action:hover:not(:disabled),
.tone-light .sleep-row:hover {
  background: var(--wp-control-fill-tertiary);
}

.tone-light .sleep-cancel {
  color: var(--wp-text-secondary);
}

/* ---------- 移动端深色贴底面板 ---------- */

.tone-dark .sleep-chip,
.tone-dark .sleep-action,
.tone-dark .sleep-row {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.tone-dark .sleep-chip:active,
.tone-dark .sleep-action:active:not(:disabled),
.tone-dark .sleep-row:active {
  background: rgba(255, 255, 255, 0.2);
}

.tone-dark .sleep-active {
  color: rgba(255, 255, 255, 0.92);
}

.tone-dark .sleep-hint {
  color: rgba(255, 255, 255, 0.5);
}

.tone-dark .sleep-cancel {
  color: rgba(255, 255, 255, 0.75);
}
</style>
