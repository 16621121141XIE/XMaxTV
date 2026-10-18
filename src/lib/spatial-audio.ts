'use client';

/**
 * 杜比全景声模式（空间音频模拟）+ 无损直通。
 *
 * 真实 Dolby Atmos 需要源音轨本身带 Atmos 元数据（EC-3/AC-4），
 * 绝大多数在线流媒体源不提供；本模块实现的是「全景声空间感模拟」——
 * 用 Web Audio API 把普通立体声上混为空间化听感：
 * - LFE：低频（<120Hz）分离并增强，模拟低音炮；
 * - 环绕：左右差信号反相延时，模拟后置环绕；
 * - 高度：差信号高频延时，模拟顶部声道；
 * 输出仍为 2.0 立体声，但空间包围感明显增强。
 *
 * 生命周期关键（修复切换无声）：
 * HTMLMediaElement 只能被 createMediaElementSource 接管一次，绑定是永久的。
 * 因此 AudioContext 与 MediaElementSourceNode 只在首次接管时创建一次并永久保留，
 * 开启/关闭/无损/杜比之间的切换只改变 source 的路由：
 * - 杜比：source → 空间化处理链 → destination
 * - 无损/关闭：source → destination（直通，保证有声）
 * 绝不重复接管同一 video，也绝不在绑定后 close 已建 ctx（否则无法恢复有声）。
 */

export class SpatialAudio {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private boundVideo: HTMLVideoElement | null = null;
  enabled = false;

  private ac(): typeof AudioContext {
    return (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    );
  }

  /** 建立/复用音频图：同一 video 只接管一次；只有换了一个 video 才重建 */
  private ensureGraph(video: HTMLVideoElement): boolean {
    try {
      if (this.ctx && this.source && this.boundVideo === video) return true;
      // 首次接管，或换了个 video：释放旧图（旧 video 已绑定过，只需断开，不能二次接管）
      if (this.source) {
        try { this.source.disconnect(); } catch { /* ignore */ }
        this.source = null;
      }
      if (this.ctx) {
        try { void this.ctx.close(); } catch { /* ignore */ }
        this.ctx = null;
      }
      const ctx = new (this.ac())();
      const source = ctx.createMediaElementSource(video);
      this.ctx = ctx;
      this.source = source;
      this.boundVideo = video;
      return true;
    } catch {
      return false;
    }
  }

  /** 直通路由（无损/关闭）：source → destination，保证有声 */
  private routeThrough(): void {
    if (this.ctx && this.source) {
      try { this.source.disconnect(); } catch { /* ignore */ }
      try { this.source.connect(this.ctx.destination); } catch { /* ignore */ }
    }
    this.enabled = false;
  }

  /** 开启杜比全景声模拟；失败（环境不支持）返回 false 并回退直通 */
  enable(video: HTMLVideoElement): boolean {
    if (!this.ensureGraph(video)) return false;
    try {
      const ctx = this.ctx as AudioContext;
      const source = this.source as MediaElementAudioSourceNode;
      source.disconnect();

      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      source.connect(split);
      // 分声道：split 的 0/1 号输出声道分别接到 L/R 增益总线
      const lBus = ctx.createGain();
      const rBus = ctx.createGain();
      split.connect(lBus, 0, 0);
      split.connect(rBus, 1, 0);
      const L: AudioNode = lBus;
      const R: AudioNode = rBus;

      // —— 主声道：直通微降，给效果声道留出空间 ——
      const mainL = ctx.createGain(); mainL.gain.value = 0.88;
      const mainR = ctx.createGain(); mainR.gain.value = 0.88;
      L.connect(mainL);
      R.connect(mainR);

      // —— LFE 低音增强：L+R 低通 120Hz ——
      const sum = ctx.createGain();
      L.connect(sum);
      R.connect(sum);
      const lfeLP = ctx.createBiquadFilter();
      lfeLP.type = 'lowpass';
      lfeLP.frequency.value = 120;
      const lfeGain = ctx.createGain();
      lfeGain.gain.value = 0.5;
      sum.connect(lfeLP);
      lfeLP.connect(lfeGain);

      // —— 环绕：差信号 (L-R) 高通 + 短延时 + 反相 ——
      const diff = ctx.createGain();
      L.connect(diff);
      const diffInv = ctx.createGain();
      diffInv.gain.value = -1;
      R.connect(diffInv);
      diffInv.connect(diff);
      const surHP = ctx.createBiquadFilter();
      surHP.type = 'highpass';
      surHP.frequency.value = 500;
      const surDelay = ctx.createDelay(0.06);
      surDelay.delayTime.value = 0.018;
      const surGain = ctx.createGain();
      surGain.gain.value = 0.32;
      const surInv = ctx.createGain();
      surInv.gain.value = -0.32;
      diff.connect(surHP);
      surHP.connect(surDelay);
      surDelay.connect(surGain);
      surDelay.connect(surInv);

      // —— 高度：差信号高通 2kHz + 短延时（模拟顶部声道） ——
      const htHP = ctx.createBiquadFilter();
      htHP.type = 'highpass';
      htHP.frequency.value = 2000;
      const htDelay = ctx.createDelay(0.06);
      htDelay.delayTime.value = 0.009;
      const htGain = ctx.createGain();
      htGain.gain.value = 0.1;
      diff.connect(htHP);
      htHP.connect(htDelay);
      htDelay.connect(htGain);

      // —— 汇总 L / R ——
      const sumL = ctx.createGain();
      const sumR = ctx.createGain();
      mainL.connect(sumL);
      mainR.connect(sumR);
      lfeGain.connect(sumL);
      lfeGain.connect(sumR);
      surGain.connect(sumL);   // 环绕正相入左
      surInv.connect(sumR);    // 环绕反相入右
      htGain.connect(sumL);
      htGain.connect(sumR);
      sumL.connect(merge, 0, 0); // L 总线 → 合并器输入 0
      sumR.connect(merge, 0, 1); // R 总线 → 合并器输入 1
      merge.connect(ctx.destination);

      // 自动播放策略下 AudioContext 可能处于 suspended，显式恢复
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

      this.enabled = true;
      return true;
    } catch {
      this.routeThrough();
      return false;
    }
  }

  /** 关闭杜比（无损/默认模式）：恢复直通，保证有声 */
  disable(): void {
    this.routeThrough();
  }
}
