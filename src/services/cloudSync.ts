/**
 * 账号数据同步引擎（喜欢 / 歌单 / 歌单曲目 / 歌曲自定义信息 / 播放历史）。
 *
 * ## 为什么用「影子表 diff」而不是给每张表加 dirty 标记
 *
 * 打标记需要在每个写入路径（喜欢、歌单增删、改名、拖拽排序、播放计数…）
 * 里插入一行代码，十几处散落在不同 store，漏一处就静默丢同步。
 * 这里改成：同步时把当前库读出来，与 `sync_shadow`（上次同步完成的快照）对比，
 * 差异即「本地改动」；影子表里有、当前库里没有的行即「本地删除」。
 * 业务代码一行都不用改。
 *
 * ## 同步顺序
 *
 * 1. 读本地快照 + 影子表 → 算差异 → push（服务端盖服务器时间戳、分配新 seq）；
 * 2. pull(since=cursor) 拉回所有变更（含墓碑），**按 seq 升序**逐条应用，
 *    所以「先删后建」「先建后删」的最终结果与服务器完全一致；
 * 3. 用应用后的本地库重建影子表，游标推进到服务端返回的位置。
 *
 * 首次登录（cursor=0）时，push 先执行，因此服务器上更早的墓碑不会覆盖你本机
 * 刚推上去的数据；两者都不删本地独有内容，等价于「并集 + LWW」。
 */

import { getDb, getSetting, setSetting } from "@/services/db";
import { cloudRequest } from "@/services/cloud";
import { useCloudStore } from "@/stores/cloud";
import { useLibraryStore } from "@/stores/library";
import { useTrackMetaStore } from "@/stores/trackMeta";
import { useHistoryStore } from "@/stores/history";

const CURSOR_KEY = "cloud.syncCursor";
const LAST_SYNC_KEY = "cloud.syncLastAt";

type Collection = "liked" | "playlists" | "playlistItems" | "trackMeta" | "history";

const COLLECTIONS: Collection[] = ["liked", "playlists", "playlistItems", "trackMeta", "history"];

/** 本地某一行（payload 是规范化后的 JSON，用于比较与推送） */
interface LocalRow {
  key: string;
  payload: string;
}

/** 服务端 pull 回来的一行（5 张表统一成这个形状） */
interface RemoteRow {
  collection: Collection;
  key: string;
  seq: number;
  deleted: boolean;
  data: Record<string, unknown>;
}

export interface SyncSummary {
  pushed: number;
  pulled: number;
  cursor: number;
  at: number;
}

/* ------------------------------ 本地快照 ------------------------------ */

function trackKey(sourceId: string, trackId: string): string {
  return `${sourceId}|${trackId}`;
}

/** 解析歌单曲目行里的 (sourceId, trackId) */
function parseTrackRef(raw: string): { sourceId: string; trackId: string } | null {
  try {
    const parsed = JSON.parse(raw) as { id?: string; sourceId?: string };
    if (!parsed?.id) return null;
    return { sourceId: parsed.sourceId ?? "", trackId: String(parsed.id) };
  } catch {
    return null;
  }
}

async function readLocal(): Promise<Record<Collection, Map<string, LocalRow>>> {
  const db = await getDb();
  const result: Record<Collection, Map<string, LocalRow>> = {
    liked: new Map(),
    playlists: new Map(),
    playlistItems: new Map(),
    trackMeta: new Map(),
    history: new Map(),
  };

  const liked = await db.select<Array<{ source_id: string; track_id: string; track: string; liked_at: number }>>(
    "select source_id, track_id, track, liked_at from liked_songs",
  );
  for (const row of liked) {
    result.liked.set(
      trackKey(row.source_id, row.track_id),
      {
        key: trackKey(row.source_id, row.track_id),
        payload: JSON.stringify({
          sourceId: row.source_id,
          trackId: row.track_id,
          track: row.track,
          likedAt: row.liked_at,
        }),
      },
    );
  }

  const playlists = await db.select<
    Array<{ id: number; name: string; description: string; cover: string; created_at: number; updated_at: number }>
  >("select id, name, description, cover, created_at, updated_at from playlists order by id asc");
  const playlistIdByName = new Map<string, number>();
  for (const row of playlists) {
    playlistIdByName.set(row.name, row.id);
    result.playlists.set(row.name, {
      key: row.name,
      payload: JSON.stringify({
        id: row.name,
        name: row.name,
        description: row.description,
        cover: row.cover,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    });
  }

  const items = await db.select<
    Array<{ playlist_id: number; track: string; position: number; added_at: number }>
  >("select playlist_id, track, position, added_at from playlist_tracks order by playlist_id asc, position asc");
  const nameById = new Map<number, string>();
  for (const [name, id] of playlistIdByName) nameById.set(id, name);
  for (const row of items) {
    const playlistName = nameById.get(row.playlist_id);
    if (!playlistName) continue;
    const ref = parseTrackRef(row.track);
    if (!ref) continue;
    const key = `${playlistName}|${ref.sourceId}|${ref.trackId}`;
    result.playlistItems.set(key, {
      key,
      payload: JSON.stringify({
        playlistId: playlistName,
        sourceId: ref.sourceId,
        trackId: ref.trackId,
        track: row.track,
        position: row.position,
        addedAt: row.added_at,
      }),
    });
  }

  const meta = await db.select<Array<{ source_id: string; track_id: string; meta: string }>>(
    "select source_id, track_id, meta from track_meta",
  );
  for (const row of meta) {
    const key = trackKey(row.source_id, row.track_id);
    result.trackMeta.set(key, {
      key,
      payload: JSON.stringify({ sourceId: row.source_id, trackId: row.track_id, meta: row.meta }),
    });
  }

  const history = await db.select<
    Array<{
      source_id: string;
      track_id: string;
      track: string;
      first_played: number;
      last_played: number;
      play_count: number;
    }>
  >("select source_id, track_id, track, first_played, last_played, play_count from play_history");
  for (const row of history) {
    const key = trackKey(row.source_id, row.track_id);
    result.history.set(key, {
      key,
      payload: JSON.stringify({
        sourceId: row.source_id,
        trackId: row.track_id,
        track: row.track,
        firstPlayed: row.first_played,
        lastPlayed: row.last_played,
        playCount: row.play_count,
      }),
    });
  }

  return result;
}

/* ------------------------------ 影子表 ------------------------------ */

async function readShadow(): Promise<Record<Collection, Map<string, string>>> {
  const db = await getDb();
  const rows = await db.select<Array<{ collection: string; key: string; payload: string }>>(
    "select collection, key, payload from sync_shadow",
  );
  const result: Record<Collection, Map<string, string>> = {
    liked: new Map(),
    playlists: new Map(),
    playlistItems: new Map(),
    trackMeta: new Map(),
    history: new Map(),
  };
  for (const row of rows) {
    const bucket = result[row.collection as Collection];
    if (bucket) bucket.set(row.key, row.payload);
  }
  return result;
}

async function writeShadow(local: Record<Collection, Map<string, LocalRow>>): Promise<void> {
  const db = await getDb();
  await db.execute("delete from sync_shadow");
  const rows: LocalRow[] = [];
  const collections: Collection[] = [];
  for (const collection of COLLECTIONS) {
    for (const row of local[collection].values()) {
      rows.push(row);
      collections.push(collection);
    }
  }
  const CHUNK = 40;
  for (let index = 0; index < rows.length; index += CHUNK) {
    const placeholders: string[] = [];
    const params: unknown[] = [];
    const end = Math.min(index + CHUNK, rows.length);
    for (let offset = index; offset < end; offset += 1) {
      const slot = offset - index;
      placeholders.push(`($${slot * 3 + 1}, $${slot * 3 + 2}, $${slot * 3 + 3})`);
      params.push(collections[offset], rows[offset].key, rows[offset].payload);
    }
    await db.execute(
      `insert or replace into sync_shadow (collection, key, payload) values ${placeholders.join(",")}`,
      params,
    );
  }
}

/* ------------------------------ 推送 ------------------------------ */

interface PushBody {
  liked: Array<Record<string, unknown>>;
  playlists: Array<Record<string, unknown>>;
  playlistItems: Array<Record<string, unknown>>;
  trackMeta: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
}

function buildPushBody(
  local: Record<Collection, Map<string, LocalRow>>,
  shadow: Record<Collection, Map<string, string>>,
): { body: PushBody; count: number } {
  const body: PushBody = { liked: [], playlists: [], playlistItems: [], trackMeta: [], history: [] };
  let count = 0;

  for (const collection of COLLECTIONS) {
    const current = local[collection];
    const before = shadow[collection];

    // 新增 / 修改
    for (const [key, row] of current) {
      if (before.get(key) === row.payload) continue;
      const data = JSON.parse(row.payload) as Record<string, unknown>;
      body[collection].push(data);
      count += 1;
    }

    // 删除：影子表里有、当前库没有 → 墓碑
    for (const key of before.keys()) {
      if (current.has(key)) continue;
      const previous = JSON.parse(before.get(key) ?? "{}") as Record<string, unknown>;
      body[collection].push({ ...previous, deleted: true });
      count += 1;
    }
  }

  return { body, count };
}

/* ------------------------------ 拉取并应用 ------------------------------ */

async function applyRemote(rows: RemoteRow[]): Promise<void> {
  const db = await getDb();
  // 按 seq 升序应用：服务器上「先删后建」的最终状态才能正确复现
  rows.sort((a, b) => a.seq - b.seq);

  for (const row of rows) {
    const data = row.data;

    if (row.collection === "liked") {
      const sourceId = String(data.sourceId ?? "");
      const trackId = String(data.trackId ?? "");
      if (!trackId) continue;
      if (row.deleted) {
        await db.execute("delete from liked_songs where source_id = $1 and track_id = $2", [
          sourceId,
          trackId,
        ]);
      } else {
        await db.execute(
          `insert into liked_songs (source_id, track_id, track, liked_at) values ($1, $2, $3, $4)
           on conflict(source_id, track_id) do update set track = $3, liked_at = $4`,
          [sourceId, trackId, String(data.track ?? ""), Number(data.likedAt ?? Date.now())],
        );
      }
      continue;
    }

    if (row.collection === "playlists") {
      const name = String(data.id ?? data.name ?? "").trim();
      if (!name) continue;
      if (row.deleted) {
        const found = await db.select<Array<{ id: number }>>(
          "select id from playlists where name = $1",
          [name],
        );
        for (const item of found) {
          await db.execute("delete from playlist_tracks where playlist_id = $1", [item.id]);
        }
        await db.execute("delete from playlists where name = $1", [name]);
      } else {
        const existing = await db.select<Array<{ id: number }>>(
          "select id from playlists where name = $1 limit 1",
          [name],
        );
        if (existing.length) {
          await db.execute(
            "update playlists set description = $2, cover = $3, updated_at = $4 where id = $1",
            [
              existing[0].id,
              String(data.description ?? ""),
              String(data.cover ?? ""),
              Number(data.updatedAt ?? Date.now()),
            ],
          );
        } else {
          await db.execute(
            "insert into playlists (name, description, cover, created_at, updated_at) values ($1, $2, $3, $4, $5)",
            [
              name,
              String(data.description ?? ""),
              String(data.cover ?? ""),
              Number(data.createdAt ?? Date.now()),
              Number(data.updatedAt ?? Date.now()),
            ],
          );
        }
      }
      continue;
    }

    if (row.collection === "playlistItems") {
      const playlistName = String(data.playlistId ?? "").trim();
      const sourceId = String(data.sourceId ?? "");
      const trackId = String(data.trackId ?? "");
      const track = String(data.track ?? "");
      if (!playlistName || !trackId) continue;

      const found = await db.select<Array<{ id: number }>>(
        "select id from playlists where name = $1 limit 1",
        [playlistName],
      );
      /**
       * 歌单行还没同步下来（可能被 limit 截断在下一批）时，先建一个占位歌单，
       * 否则这条曲目会被丢掉 —— 而它的 seq 已经小于游标，之后再也拉不到了。
       * 真正的歌单行随后到达时按名字更新，占位内容会被覆盖。
       */
      let playlistId = found[0]?.id ?? 0;
      if (!playlistId) {
        const now = Date.now();
        const created = await db.execute(
          "insert into playlists (name, description, cover, created_at, updated_at) values ($1, '', '', $2, $2)",
          [playlistName, now],
        );
        playlistId = Number(created.lastInsertId ?? 0);
        if (!playlistId) continue;
      }

      const existing = await db.select<Array<{ id: number; track: string }>>(
        "select id, track from playlist_tracks where playlist_id = $1",
        [playlistId],
      );
      const match = existing.find((candidate) => {
        const ref = parseTrackRef(candidate.track);
        return ref?.sourceId === sourceId && ref.trackId === trackId;
      });

      if (row.deleted) {
        if (match) await db.execute("delete from playlist_tracks where id = $1", [match.id]);
      } else if (match) {
        await db.execute("update playlist_tracks set track = $2, position = $3 where id = $1", [
          match.id,
          track,
          Number(data.position ?? 0),
        ]);
      } else if (track) {
        await db.execute(
          "insert into playlist_tracks (playlist_id, track, position, added_at) values ($1, $2, $3, $4)",
          [playlistId, track, Number(data.position ?? 0), Number(data.addedAt ?? Date.now())],
        );
      }
      continue;
    }

    if (row.collection === "trackMeta") {
      const sourceId = String(data.sourceId ?? "");
      const trackId = String(data.trackId ?? "");
      if (!trackId) continue;
      if (row.deleted) {
        await db.execute("delete from track_meta where source_id = $1 and track_id = $2", [
          sourceId,
          trackId,
        ]);
      } else {
        await db.execute(
          `insert into track_meta (source_id, track_id, meta, updated_at) values ($1, $2, $3, $4)
           on conflict(source_id, track_id) do update set meta = $3, updated_at = $4`,
          [sourceId, trackId, String(data.meta ?? ""), Date.now()],
        );
      }
      continue;
    }

    if (row.collection === "history") {
      const sourceId = String(data.sourceId ?? "");
      const trackId = String(data.trackId ?? "");
      if (!trackId) continue;
      if (row.deleted) {
        await db.execute("delete from play_history where source_id = $1 and track_id = $2", [
          sourceId,
          trackId,
        ]);
      } else {
        await db.execute(
          `insert into play_history (source_id, track_id, track, first_played, last_played, play_count)
           values ($1, $2, $3, $4, $5, $6)
           on conflict(source_id, track_id) do update set
             track = $3,
             first_played = min(first_played, $4),
             last_played = max(last_played, $5),
             play_count = max(play_count, $6)`,
          [
            sourceId,
            trackId,
            String(data.track ?? ""),
            Number(data.firstPlayed ?? Date.now()),
            Number(data.lastPlayed ?? Date.now()),
            Math.max(1, Number(data.playCount ?? 1)),
          ],
        );
      }
    }
  }
}

/* ------------------------------ 主流程 ------------------------------ */

let running = false;
let lastSummary: SyncSummary | null = null;

export function syncState(): { running: boolean; last: SyncSummary | null } {
  return { running, last: lastSummary };
}

export async function runSync(): Promise<SyncSummary | null> {
  const store = useCloudStore();
  await store.load();
  if (!store.configured) return null;
  if (running) return lastSummary;

  running = true;
  try {
    const context = await store.requestContext();
    if (!context) return null;

    const local = await readLocal();
    const shadow = await readShadow();
    const { body, count } = buildPushBody(local, shadow);

    const cursor = await getSetting<number>(CURSOR_KEY, 0);

    if (count > 0) {
      await cloudRequest<{ cursor: number; counts: Record<string, number> }>(
        context.base,
        "/api/sync/push",
        { method: "POST", token: context.token, body, timeoutMs: 60_000 },
      );
      /**
       * 注意：这里**不能**把游标推进到 push 返回的位置。
       * 那个值是「服务端当前最大 seq」，如果直接跳过去，就会跳过其它设备在
       * 上一次同步之后、我们这次 push 之前写入的数据。保持旧游标继续拉，
       * 自己刚推上去的行会被原样拉回来，应用一遍是幂等的，没有副作用。
       */
    }

    const pull = await cloudRequest<{
      cursor: number;
      hasMore: boolean;
      liked: Array<Record<string, unknown>>;
      playlists: Array<Record<string, unknown>>;
      playlistItems: Array<Record<string, unknown>>;
      trackMeta: Array<Record<string, unknown>>;
      history: Array<Record<string, unknown>>;
    }>(context.base, `/api/sync/pull?since=${cursor}`, { token: context.token, timeoutMs: 60_000 });

    const remote: RemoteRow[] = [];
    const push = (collection: Collection, rows: Array<Record<string, unknown>> | undefined) => {
      for (const row of rows ?? []) {
        const data = { ...row };
        const seq = Number(data.seq ?? 0);
        delete data.seq;
        remote.push({
          collection,
          key: String(data.trackId ?? data.id ?? ""),
          seq,
          deleted: Boolean(data.deleted),
          data,
        });
      }
    };
    push("liked", pull.liked);
    push("playlists", pull.playlists);
    push("playlistItems", pull.playlistItems);
    push("trackMeta", pull.trackMeta);
    push("history", pull.history);

    if (remote.length) {
      await applyRemote(remote);
      // 应用后立刻把受影响的 store 重载，界面不用重启就能看到新数据
      await Promise.allSettled([
        useLibraryStore().loadAll(),
        useTrackMetaStore().load(),
        useHistoryStore().load(),
      ]);
    }

    const appliedLocal = await readLocal();
    await writeShadow(appliedLocal);

    const nextCursor = Number(pull?.cursor ?? cursor) || 0;
    await setSetting(CURSOR_KEY, nextCursor);
    await setSetting(LAST_SYNC_KEY, Date.now());

    lastSummary = {
      pushed: count,
      pulled: remote.length,
      cursor: nextCursor,
      at: Date.now(),
    };
    return lastSummary;
  } finally {
    running = false;
  }
}

/** 上次同步时间 */
export async function lastSyncAt(): Promise<number> {
  return getSetting<number>(LAST_SYNC_KEY, 0);
}

/** 重置同步状态（换账号 / 重置云端后用；下次同步会当作首次合并） */
export async function resetSyncState(): Promise<void> {
  const db = await getDb();
  await db.execute("delete from sync_shadow");
  await setSetting(CURSOR_KEY, 0);
  await setSetting(LAST_SYNC_KEY, 0);
  lastSummary = null;
}

/* ------------------------------ 自动同步 ------------------------------ */

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动自动同步：登录后每 2 分钟跑一次 diff（读库 + 两次请求，成本很低）。
 * 之所以不做「写入即同步」，是因为那要在十几个写入点埋钩子；
 * 2 分钟的延迟对个人使用完全够，且不会因为频繁拖歌单顺序而打爆服务器。
 */
export function startAutoSync(intervalMs = 120_000): void {
  if (timer) return;
  timer = setInterval(() => {
    const store = useCloudStore();
    if (!store.configured) return;
    void runSync().catch(() => {
      /* 网络波动静默重试：下一次 tick 会再来一遍 */
    });
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
