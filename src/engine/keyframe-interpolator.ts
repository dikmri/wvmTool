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

  if (time <= sorted[0].time) {
    const kf = sorted[0];
    return { x: kf.x, y: kf.y, width: kf.width, height: kf.height };
  }

  if (time >= sorted[sorted.length - 1].time) {
    const kf = sorted[sorted.length - 1];
    return { x: kf.x, y: kf.y, width: kf.width, height: kf.height };
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
    if (rect) {
      result.push({ track, rect });
    }
  }
  return result;
}
