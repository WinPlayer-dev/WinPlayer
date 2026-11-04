-- 自动加歌单支持平台歌单
--
-- 旧记录只有 playlist_id（本地歌单主键）。平台歌单的 id 由插件平台分配、
-- 只在同一来源内有效，塞不进整数列，改用 playlist_ref 存字符串引用：
--   local:5                  → 本地歌单 5
--   neteasecloud:1234567     → 网易云插件的平台歌单
-- 平台歌单时 playlist_id 写 0，保留列只为兼容旧数据与排查。

alter table auto_playlist_done add column playlist_ref text not null default '';

-- 老记录回填成本地引用，避免设置页 / 排查时看到空引用
update auto_playlist_done set playlist_ref = 'local:' || playlist_id where playlist_ref = '';
