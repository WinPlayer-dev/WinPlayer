-- 播放历史（最近播放 / 播放次数）
--
-- 每个曲目一行（按 source_id + track_id 去重），记录首次与最近播放时间、
-- 累计次数，以及最近一次播放时的曲目快照（防止插件侧曲目改名/下架后
-- 历史页无法展示）。
--
-- 与离线下载完全独立：这里只记录"听过"，不涉及任何音频文件。

create table if not exists play_history (
  id          integer primary key autoincrement,
  source_id   text    not null,
  track_id    text    not null,
  -- UnifiedTrack JSON 快照（历史页展示用）
  track       text    not null,
  -- 首次播放时间（毫秒）
  first_played integer not null,
  -- 最近播放时间（毫秒）
  last_played  integer not null,
  -- 累计播放次数（同一曲目每次真正开始播放 +1）
  play_count   integer not null default 1,
  unique (source_id, track_id)
);

create index if not exists idx_play_history_last on play_history (last_played desc);
create index if not exists idx_play_history_count on play_history (play_count desc);
