-- 内置播放源的曲库缓存表
--
-- 与 `local_tracks` 的区别：内置源不止一种（本地音乐 / WebDAV / 以后可能还有），
-- 各自元数据字段不完全一致，因此统一存 JSON（`payload`），只把「源 + 曲目 ID」
-- 作为主键用于去重与删除。本地音乐仍用 `local_tracks`（字段固定、可增量比对）。

create table if not exists builtin_source_tracks (
  source_id text not null,
  path      text not null,
  payload   text not null,
  primary key (source_id, path)
);

create index if not exists idx_builtin_source_tracks_source
  on builtin_source_tracks (source_id);
