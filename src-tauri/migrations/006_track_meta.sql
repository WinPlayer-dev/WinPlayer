-- 歌曲自定义信息（用户手改的歌名 / 歌手 / 歌手主页 / 专辑 / 封面）
--
-- 与 liked_songs、playlist_tracks、offline_songs 里的 UnifiedTrack 快照分开存：
-- 那些表只放来源给的原始元数据，这里只放用户改写的字段（缺省字段 = 沿用原始值），
-- 于是「恢复原始信息」只要删掉一行，各处快照不用跟着改，也不会留下改名的残影。
--
-- meta 是 JSON，键全部可选：
--   { name?, artists?, artistIds?, artistSourceId?,
--     album?, albumId?, albumSourceId?, cover? }
-- artistIds 与 artists 一一对应（null 表示该歌手没有站内主页）；
-- artistSourceId / albumSourceId 记录歌手 id、专辑 id 属于哪个播放源
-- （用别的源里的歌当模板时，这两个来源与 source_id 不同）。

create table if not exists track_meta (
  source_id  text not null,
  track_id   text not null,
  meta       text not null,
  updated_at integer not null,
  primary key (source_id, track_id)
);
