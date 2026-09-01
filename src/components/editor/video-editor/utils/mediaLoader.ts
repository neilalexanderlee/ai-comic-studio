/**
 * 媒体加载工具：视频缩略图抽帧、音频波形采样等。
 * 全部使用原生 Web API（HTMLVideoElement / OffscreenCanvas / AudioContext），无第三方依赖。
 */

/** 从视频 URL 提取缩略图（均匀采样 count 帧，返回 dataURL 数组） */
export async function extractVideoThumbnails(
  url: string,
  count = 6,
): Promise<string[]> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";
    video.muted = true;
    const results: string[] = [];

    video.onloadedmetadata = async () => {
      const dur = video.duration;
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve([]); return; }

      for (let i = 0; i < count; i++) {
        video.currentTime = (dur / (count - 1)) * i;
        await new Promise<void>((res) => { video.onseeked = () => res(); });
        ctx.drawImage(video, 0, 0, 160, 90);
        results.push(canvas.toDataURL("image/jpeg", 0.6));
      }
      resolve(results);
    };
    video.onerror = () => resolve([]);
  });
}

/** 从音频 URL 提取波形数据（返回归一化的振幅数组） */
export async function extractAudioWaveform(
  url: string,
  samples = 200,
): Promise<number[]> {
  try {
    const ctx = new AudioContext();
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buffer);
    const data = decoded.getChannelData(0);
    const blockSize = Math.floor(data.length / samples);
    const waveform: number[] = [];
    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(data[i * blockSize + j]);
      }
      waveform.push(sum / blockSize);
    }
    const max = Math.max(...waveform, 0.001);
    return waveform.map((v) => v / max);
  } catch {
    return [];
  }
}

/** 从视频中提取音频波形 */
export async function extractVideoAudioWaveform(
  url: string,
  samples = 200,
): Promise<number[]> {
  // 复用 extractAudioWaveform，浏览器会自动解码视频音轨
  return extractAudioWaveform(url, samples);
}
