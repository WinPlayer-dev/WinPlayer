/**
 * 「歌词样式」设置分组视觉走查页（开发期用）。
 *
 * 入口：`npx vite` 后访问 `/.workbuddy/preview/lyric-style-preview.html`
 * （`.workbuddy/` 不进版本库，但 Vite 能直接服务根目录下的任意 html）。
 *
 * 挂的是**真实组件** LyricsStyleSection（含实时预览），样式也走生产同一份
 * `styles/lyrics-style.css`，所以截图能直接反映线上效果。
 *
 * 页面底部额外铺三块「全屏页歌词」对照：默认 / 靠左 + 加大 + 强模糊 / 无模糊无渐隐，
 * 用来看清各项设置组合起来的样子（真实播放页手机端才渲染，走查时用 UA 模拟）。
 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import "@/styles/tokens.css";
import "@/styles/motion.css";
import "@/styles/global.css";
import "@/styles/mobile.css";
import "@/styles/theme.css";
import "@/styles/lyrics-style.css";
import "@/views/settings/settings.css";
import LyricsStyleSection from "@/views/settings/appearance/LyricsStyleSection.vue";
import { useSettingsStore, LYRICS_STYLE_DEFAULT } from "@/stores/settings";
import { useIsMobile } from "@/composables/useIsMobile";
import { lyricStyleClasses, lyricStyleVars } from "@/services/lyricStyle";
import { installHarnessStubs } from "./harness";

installHarnessStubs();

const LINES = [
  { text: "雨落下的声音", translation: "" },
  { text: "把整座城市泡成一片模糊的蓝", translation: "The rain dissolves the city into blue" },
  { text: "我在便利店门口站了很久", translation: "I waited outside the store" },
  { text: "等一句不会再来的晚安", translation: "" },
  { text: "雨停之前", translation: "Before the rain stops" },
];

/** 一块「全屏歌词」：深色底 + 五句歌词，当前行是第三句 */
function LyricBlock(
  title: string,
  config: typeof LYRICS_STYLE_DEFAULT,
): ReturnType<typeof h> {
  const vars = lyricStyleVars(config);
  const classes = lyricStyleClasses(config);
  return h("div", { style: "width:300px" }, [
    h(
      "div",
      {
        class: ["wp-lrc", ...Object.entries(classes).filter(([, on]) => on).map(([key]) => key)],
        style: {
          ...vars,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: "260px",
          padding: "0 14px",
          borderRadius: "16px",
          background:
            "radial-gradient(120% 90% at 18% 12%, rgba(120,150,255,.55), transparent 62%), radial-gradient(120% 90% at 82% 88%, rgba(255,130,190,.42), transparent 60%), linear-gradient(160deg,#1b2036,#0d1020)",
        },
      },
      LINES.map((line, index) =>
        h(
          "p",
          { class: ["wp-lrc-line", `level-${Math.min(2, Math.abs(index - 2))}`] },
          [
            h("span", { class: "wp-lrc-text" }, line.text),
            line.translation && config.showTranslation
              ? h("span", { class: "wp-lrc-translation" }, line.translation)
              : null,
          ],
        ),
      ),
    ),
    h("p", { style: "font-size:12px;color:#8a8a96;margin:8px 0 0" }, title),
  ]);
}

const Host = defineComponent({
  setup() {
    const settings = useSettingsStore();
    const isMobile = useIsMobile();

    // 手机端一定要带 mobile 类：设置页的窄屏规则（卡片换行、控件满宽）全挂在
    // `.settings-page.mobile` 上，缺了它卡片会 nowrap，控件直接叠在文字上
    const pageClass = isMobile ? "settings-page mobile" : "settings-page";

    return () =>
      h("div", { class: pageClass, style: "padding:16px 14px 40px;max-width:520px" }, [
        h(LyricsStyleSection),
        h("h2", { style: "font-size:16px;margin:8px 0 12px" }, "全屏页对照"),
        h("div", { style: "display:flex;flex-wrap:wrap;gap:16px" }, [
          LyricBlock("默认（居中 / 放大 118% / 模糊 1×）", { ...LYRICS_STYLE_DEFAULT }),
          LyricBlock("靠左 / 18px / 粗体 / 强模糊", {
            ...settings.lyricsStyle,
            align: "left",
            fontSize: 18,
            fontWeight: 500,
            activeScale: 1.35,
            blurStrength: 2.2,
            inactiveOpacity: 0.5,
            lineGap: 14,
          }),
          LyricBlock("无模糊 / 无渐隐 / 不加大 / 显示全部翻译", {
            ...settings.lyricsStyle,
            fontSize: 15,
            blurInactive: false,
            maskFade: false,
            enlargeActive: false,
            activeBold: false,
            showTranslation: true,
            lineGap: 6,
          }),
        ]),
      ]);
  },
});

const app = createApp(Host);
app.use(createPinia());
app.mount("#app");
