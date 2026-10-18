<script setup lang="ts">
import { onMounted, ref } from "vue";
import { TextBox } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { OFFICIAL_MARKET_SOURCE } from "@/stores/plugins";
import { toast } from "@/services/toast";
import type { MarketSource } from "@/types/plugin";

const settings = useSettingsStore();

const newSourceName = ref("");
const newSourceUrl = ref("");

/** GitHub 镜像源编辑草稿（进入本页时从已加载的设置初始化） */
const mirrorDraft = ref("");

onMounted(() => {
  mirrorDraft.value = settings.githubMirror;
});

function addSource() {
  const name = newSourceName.value.trim();
  const url = newSourceUrl.value.trim();
  if (!url) {
    toast("请输入市场源地址", "error");
    return;
  }
  const source: MarketSource = { name: name || url, url };
  void settings.setMarketSources([...settings.marketSources, source]);
  newSourceName.value = "";
  newSourceUrl.value = "";
}

function removeSource(index: number) {
  const next = settings.marketSources.filter((_, i) => i !== index);
  void settings.setMarketSources(next);
}

function saveMirror() {
  void settings.setGithubMirror(mirrorDraft.value).then(() =>
    toast("GitHub 镜像源已保存", "success"),
  );
}
</script>

<template>
  <div>
    <!-- 插件市场 -->
    <section class="settings-section">
      <h2 class="settings-section-title">插件市场</h2>
      <div class="settings-card">
        <div class="card-content">
          <div class="card-header">GitHub 镜像源</div>
          <div class="card-description">
            配置后，凡是经 GitHub 下载的内容（插件仓库安装、市场索引、卡片图片）会自动在此前缀后拼接原始地址加速访问，例如 https://ghproxy.net/ 。留空则直连。
          </div>
        </div>
        <div class="mirror-edit">
          <TextBox
            class="mirror-input"
            :Text="mirrorDraft"
            PlaceholderText="https://ghproxy.net/"
            @update:Text="mirrorDraft = String($event ?? '')"
          />
          <button class="wp-standard-button small" @click="saveMirror">保存</button>
        </div>
      </div>

      <div class="settings-card column">
        <div class="card-content">
          <div class="card-header">市场源列表</div>
          <div class="card-description">
            每个市场源是一个 JSON 索引地址（格式见文档 docs/PLUGIN-DEVELOPMENT.md）。插件市场页会聚合展示所有源中的插件。
          </div>
        </div>

        <ul class="source-list">
          <li class="source-item">
            <div class="source-info">
              <div class="source-name">
                {{ OFFICIAL_MARKET_SOURCE.name }}
                <span class="builtin-badge">内置</span>
              </div>
              <div class="source-url ellipsis">{{ OFFICIAL_MARKET_SOURCE.url }}</div>
            </div>
          </li>
          <li v-for="(source, index) in settings.marketSources" :key="source.url" class="source-item">
            <div class="source-info">
              <div class="source-name">{{ source.name }}</div>
              <div class="source-url ellipsis">{{ source.url }}</div>
            </div>
            <button class="wp-standard-button small danger" @click="removeSource(index)">移除</button>
          </li>
        </ul>

        <div class="source-add">
          <TextBox
            class="source-input"
            :Text="newSourceName"
            PlaceholderText="名称（可选）"
            @update:Text="newSourceName = String($event ?? '')"
          />
          <TextBox
            class="source-input grow"
            :Text="newSourceUrl"
            PlaceholderText="https://example.com/market-index.json"
            @update:Text="newSourceUrl = String($event ?? '')"
          />
          <button class="wp-standard-button small" @click="addSource">添加</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mirror-edit {
  display: flex;
  gap: var(--space-md);
  flex: none;
}

.mirror-input {
  width: 280px;
}

.source-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
}

.source-item {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-md);
  background: var(--wp-control-fill-secondary);
  border-radius: var(--radius-sm);
}

.source-info {
  flex: 1;
  min-width: 0;
}

.source-name {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.builtin-badge {
  font-size: 11px;
  font-weight: 400;
  color: var(--wp-accent);
  background: var(--wp-accent-light);
  border-radius: 8px;
  padding: 1px 8px;
}

.source-url {
  font-size: 12px;
  color: var(--wp-text-tertiary);
}

.source-add {
  display: flex;
  gap: var(--space-md);
  width: 100%;
}

.source-input {
  width: 180px;
  flex: none;
}

.source-input.grow {
  flex: 1;
  width: auto;
  min-width: 0;
}
</style>
