-- 听完自动加歌单（实验性）的处理记录
--
-- 每首「自然播完」的曲目在这里留一行，标记它已经被自动歌单逻辑处理过：
-- 不管当初是加进了歌单、还是本来就在歌单里，都不会再被自动添加第二次
-- （用户手动把它从歌单删掉后也不会复活，行为可预期）。
--
-- 只有在真正解析出目标歌单时才写这一行：如果当时还没给该语种 / 类型配歌单，
-- 就什么都不记，等用户配好以后再听仍能补上。
--
-- tag 记录当时的归类结果，便于排查：
--   fixed / vocaloid / english / chinese / japanese / korean / other

create table if not exists auto_playlist_done (
  source_id   text not null,
  track_id    text not null,
  playlist_id integer not null,
  tag         text not null,
  added_at    integer not null,
  primary key (source_id, track_id)
);
