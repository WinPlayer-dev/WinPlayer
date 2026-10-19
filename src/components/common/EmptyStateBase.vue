<script setup lang="ts">
/** 空状态占位 */
defineProps<{
  icon?: string;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="empty-state">
    <span class="wp-icon empty-icon" v-html="icon || '&#xE852;'" />
    <div class="empty-title">{{ title }}</div>
    <div v-if="description" class="empty-description">{{ description }}</div>
    <div class="empty-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  gap: var(--space-md);
  text-align: center;
}

.empty-icon {
  font-size: 42px;
  color: var(--wp-text-tertiary);
  margin-bottom: var(--space-sm);
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
}

.empty-description {
  font-size: 13px;
  color: var(--wp-text-secondary);
  max-width: 420px;
  line-height: 1.6;
}

.empty-actions {
  margin-top: var(--space-lg);
  display: flex;
  gap: var(--space-md);
}
</style>
