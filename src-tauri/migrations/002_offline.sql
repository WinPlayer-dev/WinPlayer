-- 离线音乐（下载到本地的曲目索引）
-- 音频文件与 .lrc 歌词落在用户可访问的下载目录，这里只记录索引与元数据；
-- 与设置中的「缓存项 / 清除缓存」完全独立，只能在离线音乐页删除。

create table if not exists offline_songs (
  id         integer primary key autoincrement,
  source_id  text    not null,
  track_id   text    not null,
  -- UnifiedTrack JSON（离线时仍可展示歌名/歌手/专辑/封面）
  track      text    not null,
  -- 音频文件绝对路径（播放时以 local:// 前缀交给原生解码器）
  path       text    not null,
  -- 文件字节数
  size       integer not null default 0,
  -- 是否写入了同名 .lrc 歌词
  has_lyrics integer not null default 0,
  -- 来源分组 JSON 数组：[{ kind, name, sourceId, id }]
  groups     text    not null default '[]',
  saved_at   integer not null,
  unique (source_id, track_id)
);

create index if not exists idx_offline_songs_saved on offline_songs (saved_at desc);
