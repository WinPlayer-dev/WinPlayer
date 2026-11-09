<script setup lang="ts">
/**
 * 设置 → 数据。
 *
 * 存储与缓存、下载与离线、备份与还原、同步 —— 原本是四个独立分类，
 * 合计只有 13 项却占了 4 个 Tab，而且「存储 / 下载 / 备份 / 同步」四个词
 * 在用户脑子里根本分不清。合并成一类，用分组标题区分。
 */
import CacheSection from "@/views/settings/data/CacheSection.vue";
import DownloadSection from "@/views/settings/data/DownloadSection.vue";
import BackupSection from "@/views/settings/data/BackupSection.vue";
import CloudSection from "@/views/settings/data/CloudSection.vue";
</script>

<template>
  <div>
    <CacheSection />
    <DownloadSection />
    <BackupSection />
    <CloudSection />
  </div>
</template>
