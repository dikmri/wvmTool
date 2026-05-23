import type { ExportWorkerMessage, ExportWorkerResponse, MosaicTrack, VideoMeta, ExportSettings } from '../engine/types';
import { getTrackRectsAtTime } from '../engine/keyframe-interpolator';
import { logger } from '../utils/logger';
import { getOutputFileName } from '../utils/file';
import { WebGL2MosaicRenderer } from '../render/webgl/gl-context';
import { applyMosaicCanvas2D } from '../render/canvas/canvas2d-fallback';

let cancelled = false;

self.onmessage = async (e: MessageEvent<ExportWorkerMessage>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type === 'start') {
    await runExport(msg.videoData, msg.tracks, msg.settings, msg.meta);
  }
};

async function runExport(
  videoData: ArrayBuffer,
  tracks: MosaicTrack[],
  settings: ExportSettings,
  meta: VideoMeta,
): Promise<void> {
  cancelled = false;

  try {
    const MP4Box = (await import('mp4box')).default;
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

    // Choose codec
    let codecString = 'avc1.42001f';
    if (settings.videoCodec === 'vp09') codecString = 'vp09.00.10.08';
    else if (settings.videoCodec === 'av01') codecString = 'av01.0.04M.08';

    // Set up renderer
    let renderer: WebGL2MosaicRenderer | null = null;
    let useWebGL = false;
    try {
      const offscreen = new OffscreenCanvas(meta.width, meta.height);
      renderer = new WebGL2MosaicRenderer(offscreen);
      await renderer.init(meta.width, meta.height);
      useWebGL = true;
    } catch {
      logger.warn('export-worker:webgl2-unavailable', 'falling back to canvas2d');
    }

    const fps = meta.fps ?? 30;

    // Set up encoder
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width: meta.width,
        height: meta.height,
      },
      fastStart: 'in-memory',
    });

    let encodedCount = 0;
    const encoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => {
        muxer.addVideoChunk(chunk, meta);
        encodedCount++;
      },
      error: (e: Error) => logger.error('export-worker:encoder-error', e),
    });

    encoder.configure({
      codec: codecString,
      width: meta.width,
      height: meta.height,
      bitrate: settings.bitrateMode === 'manual' && settings.bitrate ? settings.bitrate : 8_000_000,
      framerate: fps,
      latencyMode: 'quality',
    });

    // Decode and process frames
    let frameIndex = 0;
    let totalFrames = 0;
    const frameDuration = 1 / fps;

    const mp4file = MP4Box.createFile();
    let decoderReady = false;
    let videoTrackId = -1;

    const frameQueue: Array<{ frame: VideoFrame; timestamp: number }> = [];
    let processingDone = false;

    const processNextFrame = async () => {
      while (frameQueue.length > 0 && !cancelled) {
        const item = frameQueue.shift()!;
        const { frame, timestamp } = item;

        try {
          // Apply mosaic
          let processedBitmap: ImageBitmap;

          if (useWebGL && renderer) {
            renderer.renderFrame(frame, tracks, timestamp);
            processedBitmap = await renderer.readPixels();
          } else {
            // Canvas2D fallback
            const offscreen = new OffscreenCanvas(meta.width, meta.height);
            const ctx = offscreen.getContext('2d')!;
            ctx.drawImage(frame, 0, 0);
            applyMosaicCanvas2D(ctx as unknown as OffscreenCanvasRenderingContext2D, tracks, timestamp, meta.width, meta.height);
            processedBitmap = await createImageBitmap(offscreen);
          }

          const outputFrame = new VideoFrame(processedBitmap, {
            timestamp: Math.round(timestamp * 1_000_000),
            duration: Math.round(frameDuration * 1_000_000),
          });

          const isKey = frameIndex % Math.round(fps * 2) === 0;
          encoder.encode(outputFrame, { keyFrame: isKey });
          outputFrame.close();
          processedBitmap.close();

          frameIndex++;
          const progress = Math.min(frameIndex, totalFrames || frameIndex);
          if (frameIndex % 10 === 0 || processingDone) {
            postProgress(progress, totalFrames || progress);
          }
        } finally {
          frame.close();
        }
      }
    };

    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        const ts = frame.timestamp / 1_000_000;
        frameQueue.push({ frame, timestamp: ts });
        processNextFrame().catch((e) => logger.error('export-worker:process-error', e));
      },
      error: (e: Error) => logger.error('export-worker:decoder-error', e),
    });

    await new Promise<void>((resolve, reject) => {
      mp4file.onReady = (info: { videoTracks: { id: number; codec: string; nb_samples?: number }[] }) => {
        const track = info.videoTracks[0];
        if (!track) { reject(new Error('No video track')); return; }
        videoTrackId = track.id;
        totalFrames = track.nb_samples ?? 0;
        decoderReady = true;

        decoder.configure({
          codec: track.codec,
          codedWidth: meta.width,
          codedHeight: meta.height,
        });

        mp4file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
        mp4file.start();
      };

      mp4file.onSamples = async (
        _id: number,
        _ref: unknown,
        samples: Array<{
          data: Uint8Array;
          dts: number;
          duration: number;
          is_sync: boolean;
          timescale: number;
          number?: number;
        }>,
      ) => {
        if (!decoderReady) return;
        if (totalFrames === 0) totalFrames = samples.length;

        for (const sample of samples) {
          if (cancelled) break;
          const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: (sample.dts / sample.timescale) * 1_000_000,
            duration: (sample.duration / sample.timescale) * 1_000_000,
            data: sample.data,
          });
          decoder.decode(chunk);
        }

        if (samples.length > 0 && (samples[samples.length - 1].number ?? 0) >= totalFrames - 1) {
          processingDone = true;
        }

        await decoder.flush().catch((e) => logger.warn('decoder flush warn', e));

        // Wait for frame queue to drain
        while (frameQueue.length > 0 && !cancelled) {
          await new Promise<void>((r) => setTimeout(r, 10));
        }

        if (!cancelled) {
          await encoder.flush().catch((e) => logger.warn('encoder flush warn', e));
          muxer.finalize();
          resolve();
        } else {
          resolve();
        }
      };

      mp4file.onError = (e: Error) => reject(e);

      const buf = videoData as ArrayBuffer & { fileStart?: number };
      buf.fileStart = 0;
      mp4file.appendBuffer(buf);
      mp4file.flush();
    });

    if (cancelled) {
      encoder.close();
      decoder.close();
      renderer?.dispose();
      const resp: ExportWorkerResponse = { type: 'cancelled' };
      self.postMessage(resp);
      return;
    }

    encoder.close();
    decoder.close();
    renderer?.dispose();

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    const resp: ExportWorkerResponse = {
      type: 'done',
      blob,
      fileName: getOutputFileName('output', settings.outputFileSuffix),
    };
    self.postMessage(resp);
  } catch (err) {
    const resp: ExportWorkerResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(resp);
  }
}

function postProgress(current: number, total: number): void {
  const resp: ExportWorkerResponse = { type: 'progress', current, total };
  self.postMessage(resp);
}
