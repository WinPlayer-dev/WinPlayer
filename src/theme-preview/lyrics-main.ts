/**
 * 桌面歌词窗口的视觉走查页（仅开发期）。
 *
 * 组件本身的数据来自 Tauri 事件，浏览器里没有事件通道，因此这里把状态注入
 * `window.__WP_LYRICS_PREVIEW__`（组件在非 Tauri 环境下会读它）。
 * 查询参数：style=plain|glass、bg=dark|light、long=1、size=28、nocover=1、
 * locked=1（锁定态）、pointer=1（锁定 + 游标在窗口内，用来检查解锁按钮）。
 */
import { createApp } from "vue";
import "@/styles/lyrics-window.css";
import DesktopLyricsWindow from "@/components/desktop-lyrics/DesktopLyricsWindow.vue";

const params = new URLSearchParams(window.location.search);
const style = params.get("style") === "glass" ? "glass" : "plain";
const background = params.get("bg") === "light" ? "light" : "dark";

/** 假封面（SVG，不依赖网络）：卡片底就是这张图放大模糊后的效果 */
const COVER = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
  <defs>
    <radialGradient id="a" cx="30%" cy="25%" r="80%">
      <stop offset="0%" stop-color="#ffb36b"/>
      <stop offset="55%" stop-color="#c2405e"/>
      <stop offset="100%" stop-color="#2a1b46"/>
    </radialGradient>
    <radialGradient id="b" cx="78%" cy="80%" r="60%">
      <stop offset="0%" stop-color="#4fd6c2" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#4fd6c2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#a)"/>
  <rect width="600" height="600" fill="url(#b)"/>
</svg>`)}`;

const preview = {
  prev: "教室的窗外是晴天",
  prevTranslation: "A sunny day outside the classroom",
  text:
    params.get("long") === "1"
      ? "这是一句特别特别长的歌词用来测试两行截断效果会不会溢出窗口边界"
      : "雨下整夜 我的爱溢出就像雨水",
  translation: "The rain falls all night, my love overflows like rainwater",
  next: "院子落叶 跟我的思念厚厚一叠",
  nextTranslation: "Leaves fall in the yard, piling up my longing",
  seq: 1,
  playing: true,
  hasLyrics: true,
  style,
  fontSize: Number(params.get("size") ?? 30),
  locked: params.get("locked") === "1",
  pointerInside: params.get("pointer") === "1",
  title: "七里香",
  artist: "周杰伦 · 七里香",
  cover: params.get("nocover") === "1" ? "" : COVER,
};

(window as unknown as { __WP_LYRICS_PREVIEW__?: typeof preview }).__WP_LYRICS_PREVIEW__ = preview;

// 模拟壁纸：用来检查纯文字描边在亮 / 暗背景上的对比度
document.body.style.background =
  background === "light"
    ? "linear-gradient(135deg, #f6d7c3 0%, #e8e2f2 45%, #cfe3ef 100%)"
    : "linear-gradient(135deg, #1b2431 0%, #2d2337 55%, #101820 100%)";

// 预览页按窗口默认尺寸摆放：歌曲卡片 680×402、纯文字 900×250
document.body.style.width = style === "glass" ? "680px" : "900px";
document.body.style.height = style === "glass" ? "402px" : "250px";
document.body.style.overflow = "hidden";

createApp(DesktopLyricsWindow).mount("#app");
