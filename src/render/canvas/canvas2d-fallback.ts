import type { MosaicTrack } from '../../engine/types';
import { getTrackRectsAtTime } from '../../engine/keyframe-interpolator';

// Canvas 2D fallback mosaic renderer for environments without WebGL2
export function applyMosaicCanvas2D(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  tracks: MosaicTrack[],
  time: number,
  width: number,
  height: number,
): void {
  const trackRects = getTrackRectsAtTime(tracks, time);

  for (const { track, rect } of trackRects) {
    const blockSize = track.mosaicSize;
    const x = Math.floor(rect.x);
    const y = Math.floor(rect.y);
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    if (w <= 0 || h <= 0) continue;

    // Clamp to canvas bounds
    const cx = Math.max(0, x);
    const cy = Math.max(0, y);
    const cw = Math.min(w, width - cx);
    const ch = Math.min(h, height - cy);

    if (cw <= 0 || ch <= 0) continue;

    const imageData = ctx.getImageData(cx, cy, cw, ch);
    const data = imageData.data;

    for (let by = 0; by < ch; by += blockSize) {
      for (let bx = 0; bx < cw; bx += blockSize) {
        // Sample center pixel of block
        const sx = Math.min(bx + Math.floor(blockSize / 2), cw - 1);
        const sy = Math.min(by + Math.floor(blockSize / 2), ch - 1);
        const idx = (sy * cw + sx) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        // Fill block
        for (let py = by; py < Math.min(by + blockSize, ch); py++) {
          for (let px = bx; px < Math.min(bx + blockSize, cw); px++) {
            const i = (py * cw + px) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
          }
        }
      }
    }

    ctx.putImageData(imageData, cx, cy);
  }
}
