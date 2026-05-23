import type { MosaicTrack } from '../../engine/types';
import { getTrackRectsAtTime } from '../../engine/keyframe-interpolator';

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
    const rotation = (rect.rotation ?? 0) * Math.PI / 180;

    if (Math.abs(rotation) < 0.001) {
      // Fast path: no rotation — use original axis-aligned approach
      const x = Math.floor(rect.x);
      const y = Math.floor(rect.y);
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w <= 0 || h <= 0) continue;
      const cx = Math.max(0, x);
      const cy = Math.max(0, y);
      const cw = Math.min(w, width - cx);
      const ch = Math.min(h, height - cy);
      if (cw <= 0 || ch <= 0) continue;

      const imageData = ctx.getImageData(cx, cy, cw, ch);
      const data = imageData.data;

      for (let by = 0; by < ch; by += blockSize) {
        for (let bx = 0; bx < cw; bx += blockSize) {
          const sx = Math.min(bx + Math.floor(blockSize / 2), cw - 1);
          const sy = Math.min(by + Math.floor(blockSize / 2), ch - 1);
          const idx = (sy * cw + sx) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
          for (let py = by; py < Math.min(by + blockSize, ch); py++) {
            for (let px = bx; px < Math.min(bx + blockSize, cw); px++) {
              const i = (py * cw + px) * 4;
              data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
            }
          }
        }
      }
      ctx.putImageData(imageData, cx, cy);
    } else {
      // Rotated path: check each pixel in the bounding box against the rotated rect
      const rcx = rect.x + rect.width / 2;
      const rcy = rect.y + rect.height / 2;
      const hw = rect.width / 2;
      const hh = rect.height / 2;
      const cosA = Math.cos(rotation);
      const sinA = Math.sin(rotation);
      // Inverse rotation (from global to local)
      const icosA = cosA;   // cos(-rotation) = cos(rotation)
      const isinA = -sinA;  // sin(-rotation) = -sin(rotation)

      // Bounding box
      const maxR = Math.sqrt(hw * hw + hh * hh);
      const bx = Math.max(0, Math.floor(rcx - maxR));
      const by = Math.max(0, Math.floor(rcy - maxR));
      const bw = Math.min(Math.ceil(maxR * 2), width - bx);
      const bh = Math.min(Math.ceil(maxR * 2), height - by);
      if (bw <= 0 || bh <= 0) continue;

      const imageData = ctx.getImageData(bx, by, bw, bh);
      const data = imageData.data;
      const origData = new Uint8ClampedArray(data);

      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          // Offset from rect center in global coords
          const gx = bx + px - rcx;
          const gy = by + py - rcy;
          // Transform to local (unrotated) frame
          const lx = gx * icosA - gy * isinA;
          const ly = gx * isinA + gy * icosA;

          if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) {
            // Block center in local frame
            const blcx = (Math.floor((lx + hw) / blockSize) + 0.5) * blockSize - hw;
            const blcy = (Math.floor((ly + hh) / blockSize) + 0.5) * blockSize - hh;
            // Rotate block center back to global frame
            const sampleGX = rcx + blcx * cosA - blcy * sinA;
            const sampleGY = rcy + blcx * sinA + blcy * cosA;
            // Map to imageData coords
            const sx = Math.round(sampleGX - bx);
            const sy = Math.round(sampleGY - by);
            const clSX = Math.max(0, Math.min(sx, bw - 1));
            const clSY = Math.max(0, Math.min(sy, bh - 1));
            const si = (clSY * bw + clSX) * 4;
            const di = (py * bw + px) * 4;
            data[di]     = origData[si];
            data[di + 1] = origData[si + 1];
            data[di + 2] = origData[si + 2];
            data[di + 3] = origData[si + 3];
          }
        }
      }
      ctx.putImageData(imageData, bx, by);
    }
  }
}
