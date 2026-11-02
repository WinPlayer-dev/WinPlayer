-- 同频服务器同步的本地辅助表
--
-- `sync_shadow` 记录「上一次同步完成时，每条数据长什么样」。同步引擎拿它和当前库
-- 做 diff 就能推断出「本地新增/改过/删了哪些行」，因此**不需要**在每个写入路径
-- （喜欢、歌单、历史、自定义信息）里插入打标记的代码 —— 少改十几处业务逻辑，
-- 也不会因为漏改某处而丢同步。
--
-- `sync_state` 存同步游标（服务端 seq）与上次同步时间。

create table if not exists sync_shadow (
  -- 集合名：liked / playlists / playlistItems / trackMeta / history
  collection text not null,
  -- 该集合内的稳定键（如 `sourceId|trackId`、歌单名）
  key        text not null,
  -- 上一次同步时该行的规范化 JSON（用于判断是否变化）
  payload    text not null,
  primary key (collection, key)
);

create table if not exists sync_state (
  key   text primary key,
  value text not null
);
