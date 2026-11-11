<script setup lang="ts">
import { onMounted, ref } from "vue";
import { TextBox } from "@/components/winui";
import { useSettingsStore } from "@/stores/settings";
import { OFFICIAL_MARKET_SOURCE } from "@/stores/plugins";
import { toast } from "@/services/toast";
import type { MarketSource } from "@/types/plugin";
import { useI18n } from "@/i18n";
import SettingsSection from "@/views/settings/components/SettingsSection.vue";
import WpButton from "@/components/theme/WpButton.vue";
import WpCard from "@/components/theme/WpCard.vue";

const settings = useSettingsStore();
const { t } = useI18n();

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
    toast(t("settings.plugins.market.errors.urlRequired"), "error");
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
    toast(t("settings.plugins.market.mirror.saved"), "success"),
  );
}
</script>

<template>
  <SettingsSection id="plugins-market" :title="t('settings.plugins.market.section')">
    <WpCard variant="row">
        <div class="card-content">
          <div class="card-header">{{ t("settings.plugins.market.mirror.title") }}</div>
          <div class="card-description">
            {{ t("settings.plugins.market.mirror.description") }}
          </div>
        </div>
        <div class="mirror-edit">
          <TextBox
            class="mirror-input"
            :Text="mirrorDraft"
            PlaceholderText="https://ghproxy.net/"
            @update:Text="mirrorDraft = String($event ?? '')"
          />
          <WpButton variant="standard" class="small" @click="saveMirror">{{ t("common.action.save") }}</WpButton>
        </div>
      </WpCard>

      <WpCard variant="column">
        <div class="card-content">
          <div class="card-header">{{ t("settings.plugins.market.sources.title") }}</div>
          <div class="card-description">
            {{ t("settings.plugins.market.sources.description") }}
          </div>
        </div>

        <ul class="source-list">
          <li class="source-item">
            <div class="source-info">
              <div class="source-name">
                {{ OFFICIAL_MARKET_SOURCE.name }}
                <span class="builtin-badge">{{ t("settings.plugins.market.sources.builtin") }}</span>
              </div>
              <div class="source-url ellipsis">{{ OFFICIAL_MARKET_SOURCE.url }}</div>
            </div>
          </li>
          <li v-for="(source, index) in settings.marketSources" :key="source.url" class="source-item">
            <div class="source-info">
              <div class="source-name">{{ source.name }}</div>
              <div class="source-url ellipsis">{{ source.url }}</div>
            </div>
            <WpButton variant="standard" class="small danger" @click="removeSource(index)">{{ t("common.action.remove") }}</WpButton>
          </li>
        </ul>

        <div class="source-add">
          <TextBox
            class="source-input"
            :Text="newSourceName"
            :PlaceholderText="t('settings.plugins.market.sources.namePlaceholder')"
            @update:Text="newSourceName = String($event ?? '')"
          />
          <TextBox
            class="source-input grow"
            :Text="newSourceUrl"
            PlaceholderText="https://example.com/market-index.json"
            @update:Text="newSourceUrl = String($event ?? '')"
          />
          <WpButton variant="standard" class="small" @click="addSource">{{ t("common.action.add") }}</WpButton>
        </div>
      </WpCard>
  </SettingsSection>
</template><style scoped>
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
