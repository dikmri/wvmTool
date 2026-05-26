import type { MosaicKeyframe, MosaicTrack, InterpolatedRect } from './types';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function interpolateKeyframes(
  keyframes: MosaicKeyframe[],
  time: number,
): InterpolatedRect | null {
  if (keyframes.length === 0) return null;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // visible uses a step function: find the last keyframe at or before time
  function stepVisible(kfs: MosaicKeyframe[], t: number): boolean {
    let v = true;
    for (const kf of kfs) {
      if (kf.time <= t) v = kf.visible ?? true;
    }
    return v;
  }

  // 最初のキーフレームより前はモザイクなし（逆方向への延伸をしない）
  if (time < sorted[0].time) return null;

  if (time >= sorted[sorted.length - 1].time) {
    const kf = sorted[sorted.length - 1];
    return { x: kf.x, y: kf.y, width: kf.width, height: kf.height, rotation: kf.rotation ?? 0, visible: kf.visible ?? true };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time);
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t),
        height: lerp(a.height, b.height, t),
        rotation: lerp(a.rotation ?? 0, b.rotation ?? 0, t),
        visible: stepVisible(sorted, time),
      };
    }
  }

  return null;
}

export function getTrackRectsAtTime(
  tracks: MosaicTrack[],
  time: number,
): Array<{ track: MosaicTrack; rect: InterpolatedRect }> {
  const result: Array<{ track: MosaicTrack; rect: InterpolatedRect }> = [];
  for (const track of tracks) {
    if (!track.enabled) continue;
    const rect = interpolateKeyframes(track.keyframes, time);
    if (rect && rect.visible !== false) {
      result.push({ track, rect });
    }
  }
  return result;
}
