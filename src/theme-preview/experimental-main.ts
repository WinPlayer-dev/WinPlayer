/** 设置 → 实验性（含听完自动加歌单）视觉走查入口，仅开发期使用。 */
import { createApp, defineComponent, h } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import "@/views/settings/settings.css";
import ExperimentalSettings from "@/views/settings/experimental/AutoPlaylistSection.vue";
import { installHarnessStubs, mountBuiltinTheme } from "./harness";
import { useLibraryStore } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";

installHarnessStubs();
document.documentElement.dataset.theme = "light";

const pinia = createPinia();
setActivePinia(pinia);

const library = useLibraryStore();
library.playlists = [
  {
    id: 1,
    name: "每日循环",
    description: "",
    cover: "",
    createdAt: 0,
    updatedAt: 0,
    trackCount: 12,
  },
  { id: 2, name: "华语流行", description: "", cover: "", createdAt: 0, updatedAt: 0 },
  { id: 3, name: "日语", description: "", cover: "", createdAt: 0, updatedAt: 0 },
  { id: 4, name: "Vocaloid", description: "", cover: "", createdAt: 0, updatedAt: 0 },
];

const settings = useSettingsStore();
settings.autoPlaylist = {
  enabled: true,
  mode: "auto",
  fixedTarget: null,
  languageTargets: {
    english: { kind: "local", id: 1, name: "每日循环" },
    chinese: { kind: "local", id: 2, name: "华语流行" },
    japanese: { kind: "local", id: 3, name: "日语" },
    korean: null,
    other: null,
  },
  vocaloidTarget: { kind: "local", id: 4, name: "Vocaloid" },
  vocaloidKeywords: ["Fukase", "v flower"],
};

const Host = defineComponent({
  setup() {
    return () =>
      h("div", { class: "settings-page app-shell", style: "padding:24px;overflow:auto" }, [
        h(ExperimentalSettings),
      ]);
  },
});

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});

const app = createApp(Host);
app.use(pinia);
app.use(router);
app.mount("#app");

void mountBuiltinTheme();
