/** 设置文案走查预览（临时）：把几个设置页竖排挂在一起看行数与换行 */
import { createApp, defineComponent, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/styles/theme.css";
import "@/views/settings/settings.css";
import GeneralSettings from "@/views/settings/GeneralSettings.vue";
import PlaybackSettings from "@/views/settings/PlaybackSettings.vue";
import DownloadSettings from "@/views/settings/DownloadSettings.vue";
import StorageSettings from "@/views/settings/StorageSettings.vue";
import StyleSettings from "@/views/settings/StyleSettings.vue";
import { installHarnessStubs } from "./harness";

installHarnessStubs();

const PAGES = [
  ["通用", GeneralSettings],
  ["播放", PlaybackSettings],
  ["下载", DownloadSettings],
  ["存储", StorageSettings],
  ["样式", StyleSettings],
] as const;

const Host = defineComponent({
  setup() {
    return () =>
      h("div", { class: "settings-page app-shell", style: "padding:24px;overflow:auto" }, [
        h(
          "div",
          {},
          PAGES.map(([title, component]) =>
            h("div", { "data-page": title }, [
              h("h1", { style: "font-size:16px;margin:12px 0" }, title),
              h(component),
            ]),
          ),
        ),
      ]);
  },
});

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: { render: () => null } }],
});

const app = createApp(Host);
app.use(createPinia());
app.use(router);
app.mount("#app");
