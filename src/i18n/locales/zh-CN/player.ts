/**
 * 播放器词条：播放条、队列、正在播放页、歌词、音质、播放模式。
 *
 * 歌词相关的词条只放**界面文案**；歌词内容本身来自音源，不翻译。
 */
export default {
  bar: {
    /** 睡眠定时器到点后的提示 */
    sleepStopped: "睡眠定时器已停止播放",
  },

  queue: {
    /** `{count}` 为本次实际加入的曲目数 */
    added: "已添加 {count} 首到播放队列",
    alreadyInQueue: "歌曲已在播放队列中",
  },

  nowPlaying: {},

  lyrics: {
    loading: "歌词加载中…",
    empty: "暂无歌词",
  },

  quality: {},

  /** 播放模式名（`types/player.ts` 的 PLAY_MODE_LABEL） */
  mode: {
    sequential: "顺序播放",
    loopAll: "列表循环",
    loopOne: "单曲循环",
    shuffle: "随机播放",
  },

  /** 均衡器预设名（`constants/eqPresets.ts`） */
  eqPreset: {
    flat: "平坦",
    pop: "流行",
    rock: "摇滚",
    classical: "古典",
    jazz: "爵士",
    electronic: "电子",
    vocal: "人声",
    bass: "低音增强",
  },
};
