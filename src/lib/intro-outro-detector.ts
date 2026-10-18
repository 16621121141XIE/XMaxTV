'use client';

/**
 * 片头/片尾智能检测（无用户配置，全自动）。
 *
 * 思路：
 * - 片头：同一部剧的各集开头（片头曲/厂标）画面相同，正片内容不同。
 *   播放时对开头 120 秒做低分辨率亮度采样，与上一集的开头采样序列滑动对比，
 *   两集画面首次出现持续分歧的位置 ≈ 片头结束位置。
 * - 片尾：多数剧集片尾曲结束、演职员表结束后会黑屏/暗场。
 *   播放接近结尾（剩余 < 60 秒）时检测连续暗帧，判定片尾开始，交由播放器跳到结尾触发连播。
 *
 * 跨域直连时 canvas 会被污染（getImageData 抛 SecurityError），此时检测自动降级为不可用，
 * 不影响正常播放。
 */

/** 采样间隔（毫秒） */
export const SAMPLE_MS = 800;
/** 片头学习窗口：只分析每集开头的这段时长（秒） */
export const INTRO_WINDOW_SEC = 120;
/** 片尾检测窗口：剩余秒数小于该值才启动暗帧检测 */
export const OUTRO_WINDOW_SEC = 60;
/** 判定「两集画面分歧」所需的连续差异帧数 */
const DIVERGE_RUN = 6;
/** 判定「分歧」的单帧灰度差阈值（0-1 亮度域） */
const DIVERGE_DIFF = 0.18;
/** 判定「片头区匹配」的单帧灰度差阈值：小于该值视为两集画面相同 */
const MATCH_DIFF = 0.12;
/** 有效片头秒数范围：过短/过长视为误检 */
export const MIN_INTRO_SEC = 5;
export const MAX_INTRO_SEC = 90;
/** 判定「片尾黑屏」所需的连续暗帧数（配合 timeupdate 约 4Hz 触发） */
export const OUTRO_BLACK_RUN = 6;
/** 判定「暗帧」的亮度阈值（0-1） */
const BLACK_LUMA = 0.05;

/**
 * 捕获当前视频帧的平均亮度（0-1）。
 * canvas 被跨域污染（直连源）时返回 null，检测降级。
 */
export function captureLuma(video: HTMLVideoElement): number | null {
  try {
    if (!video || video.readyState < 2) return null;
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 9;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 16, 9);
    const data = ctx.getImageData(0, 0, 16, 9).data;
    let sum = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    return sum / n / 255;
  } catch {
    return null;
  }
}

/**
 * 在「当前集开头采样」与「上一集开头采样」之间找片头结束位置。
 * 两序列按时间轴对齐（同为开头起、同采样间隔），从前往后滑动：
 * 前段两集画面相同（片头）→ 差小；到某帧起连续多帧差大（正片分歧）→ 该帧即片头结束。
 * @returns 片头秒数；未检出返回 0
 */
export function findIntroSeconds(prev: number[], cur: number[]): number {
  const n = Math.min(prev.length, cur.length);
  if (n < 12) return 0; // 采样不足，先不判定
  let matchRun = 0;
  for (let i = 0; i < n; i++) {
    const diff = Math.abs(prev[i] - cur[i]);
    if (diff < MATCH_DIFF) {
      matchRun++;
      // 需要前段确认足够长的「相同区」（至少 4 秒），才值得找分歧
      if (matchRun >= 5) {
        // 从 i 之后找连续分歧
        let run = 0;
        for (let j = i + 1; j < n; j++) {
          const d = Math.abs(prev[j] - cur[j]);
          if (d > DIVERGE_DIFF) {
            run++;
            if (run >= DIVERGE_RUN) {
              const sec = Math.round(((j - DIVERGE_RUN + 1) * SAMPLE_MS) / 1000);
              if (sec >= MIN_INTRO_SEC && sec <= MAX_INTRO_SEC) return sec;
              return 0;
            }
          } else {
            run = 0;
          }
        }
        return 0;
      }
    } else {
      matchRun = 0;
    }
  }
  return 0;
}
