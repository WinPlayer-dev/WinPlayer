-- 本地音乐曲库索引（内置播放源「本地音乐」）
--
-- 一次扫描一个文件写一行；`size` + `mtime` 用于下次扫描的增量判定
-- （未变化就不再解析标签）。曲目 ID 直接取 path。

create table if not exists local_tracks (
  path         text primary key,
  folder       text    not null,
  file_name    text    not null,
  size         integer not null default 0,
  mtime        integer not null default 0,
  title        text    not null default '',
  artist       text    not null default '',
  album        text    not null default '',
  album_artist text    not null default '',
  genre        text    not null default '',
  year         text    not null default '',
  track_no     integer not null default 0,
  disc_no      integer not null default 0,
  duration     integer not null default 0,
  bitrate      integer not null default 0,
  cover        text    not null default '',
  has_lyrics   integer not null default 0
);

create index if not exists idx_local_tracks_folder on local_tracks (folder);
create index if not exists idx_local_tracks_album on local_tracks (album, album_artist);
create index if not exists idx_local_tracks_artist on local_tracks (artist);
