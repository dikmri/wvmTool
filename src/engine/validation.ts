import type { Capability } from './types';

export async function checkCapabilities(): Promise<Capability> {
  const webCodecs = typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined';
  const videoDecoder = typeof VideoDecoder !== 'undefined';
  const videoEncoder = typeof VideoEncoder !== 'undefined';
  const offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  const worker = typeof Worker !== 'undefined';

  let webgl2 = false;
  try {
    const canvas = document.createElement('canvas');
    webgl2 = !!canvas.getContext('webgl2');
  } catch {
    webgl2 = false;
  }

  let webgpu = false;
  try {
    webgpu = 'gpu' in navigator && !!(await (navigator as Navigator & { gpu?: GPU }).gpu?.requestAdapter());
  } catch {
    webgpu = false;
  }

  return { webCodecs, videoDecoder, videoEncoder, offscreenCanvas, webgl2, webgpu, worker };
}
