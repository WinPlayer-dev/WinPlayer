/// <reference lib="webworker" />
/**
 * 插件沙箱 Worker
 *
 * 插件的 JavaScript 代码在此执行，与主界面完全隔离：
 * - 无 DOM / 无 window / 无 Tauri invoke
 * - 网络访问只能通过 ctx.request → RPC 转发给宿主 → Rust 后端代理
 * - 插件存储通过 ctx.storage → RPC 转发给宿主 → Rust 落盘
 */

import type { PluginContext, PluginModule, PluginRequest, PluginResponse } from "@/types/plugin";
import type { HostMessage, WorkerMessage } from "./protocol";

const REQUEST_TIMEOUT_MS = 60_000;

let plugin: PluginModule | null = null;
let pluginContext: PluginContext | null = null;
let rpcId = 0;
const pendingRpc = new Map<number, { resolve: (v: PluginResponse) => void; reject: (e: Error) => void; timer: number }>();

function post(message: WorkerMessage): void {
  self.postMessage(message);
}

/** 网络请求：转发给宿主，由 Rust 后端代理 */
function hostRequest(input: PluginRequest): Promise<PluginResponse> {
  const id = ++rpcId;
  return new Promise<PluginResponse>((resolve, reject) => {
    const timer = self.setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`插件网络请求超时: ${input.url}`));
    }, REQUEST_TIMEOUT_MS);
    pendingRpc.set(id, { resolve, reject, timer });
    post({ type: "rpc-request", id, payload: input });
  });
}

/** 私有存储：读写经宿主转发到 Rust 落盘（键值缓存在 worker 内存） */
let storageCache: Record<string, unknown> | null = null;

async function ensureStorage(): Promise<Record<string, unknown>> {
  if (!storageCache) {
    const response = await hostRequest({
      url: "plugin-internal://storage/get",
      responseType: "text",
    });
    try {
      storageCache = JSON.parse(response.text ?? "{}") as Record<string, unknown>;
    } catch {
      storageCache = {};
    }
  }
  return storageCache;
}

function createContext(settings: Record<string, unknown>): PluginContext {
  return {
    settings,
    request: hostRequest,
    storage: {
      async get<T>(key: string): Promise<T | null> {
        const cache = await ensureStorage();
        return (cache[key] as T) ?? null;
      },
      async set(key: string, value: unknown): Promise<void> {
        const cache = await ensureStorage();
        cache[key] = value;
        await hostRequest({
          url: "plugin-internal://storage/set",
          method: "POST",
          body: JSON.stringify(cache),
          responseType: "text",
        });
      },
    },
    log(...args: unknown[]) {
      post({ type: "log", level: "log", args });
    },
  };
}

/** 加载插件模块：优先 ESM 动态导入，回退 CommonJS 风格 */
async function loadPluginModule(code: string): Promise<PluginModule> {
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const module = (await import(/* @vite-ignore */ url)) as { default?: PluginModule } & PluginModule;
    const target = module.default ?? module;
    if (!target || typeof target !== "object") {
      throw new Error("插件模块未导出对象（应 export default { ... }）");
    }
    return target;
  } catch (esmError) {
    // 回退：以 CommonJS 语义执行（module.exports = {...}）
    try {
      const moduleShim = { exports: {} as Record<string, unknown> };
      const factory = new Function(
        "module",
        "exports",
        "globalThis",
        `${code}\n//# sourceURL=winplayer-plugin.js`,
      );
      factory(moduleShim, moduleShim.exports, globalThis);
      const exported = moduleShim.exports as { default?: PluginModule } & PluginModule;
      const target = exported.default ?? exported;
      if (!target || typeof target !== "object") {
        throw esmError;
      }
      return target;
    } catch (cjsError) {
      throw new Error(
        `插件代码加载失败: ${cjsError instanceof Error ? cjsError.message : String(cjsError)}`,
      );
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 允许被宿主调用的方法白名单 */
const INVOKEABLE_METHODS = new Set([
  "search",
  "getSongUrl",
  "getPlaylist",
  // 专辑 / 歌手（能力：album、artist）
  "getAlbum",
  "getArtist",
  "getArtistAlbums",
  "getRecommendations",
  "getLyrics",
  "getHotKeywords",
  // 登录（能力：login）
  "getLoginQr",
  "pollLogin",
  "getLoginState",
  "logout",
  // 头像（能力：avatar）
  "getAvatar",
  // 个人歌单（能力：myPlaylists）
  "getUserPlaylists",
  "addToUserPlaylist",
  "removeFromUserPlaylist",
  // 播放回传（能力：playRecord）
  "reportPlay",
]);

async function handleMessage(message: HostMessage): Promise<void> {
  switch (message.type) {
    case "init": {
      try {
        pluginContext = createContext(message.settings);
        plugin = await loadPluginModule(message.code);
        if (typeof plugin.init === "function") {
          await plugin.init(pluginContext);
        }
        post({ type: "result", id: 0, ok: true });
      } catch (error) {
        plugin = null;
        post({
          type: "result",
          id: 0,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
    case "invoke": {
      try {
        if (!plugin) throw new Error("插件尚未初始化");
        if (!INVOKEABLE_METHODS.has(message.method)) {
          throw new Error(`不允许调用的方法: ${message.method}`);
        }
        const method = (plugin as Record<string, unknown>)[message.method];
        if (typeof method !== "function") {
          throw new Error(`插件未实现方法: ${message.method}`);
        }
        const value = await (method as (arg: unknown) => unknown).call(plugin, message.args ?? {});
        post({ type: "result", id: message.id, ok: true, value: value ?? null });
      } catch (error) {
        post({
          type: "result",
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
    case "rpc-response": {
      const pending = pendingRpc.get(message.id);
      if (pending) {
        pendingRpc.delete(message.id);
        self.clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.value as PluginResponse);
        else pending.reject(new Error(message.error ?? "代理请求失败"));
      }
      break;
    }
    case "dispose": {
      try {
        if (plugin && typeof plugin.dispose === "function") {
          await plugin.dispose();
        }
      } catch {
        /* 忽略清理错误 */
      }
      plugin = null;
      self.close();
      break;
    }
  }
}

self.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  void handleMessage(event.data);
});
