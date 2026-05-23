import type { ExportWorkerMessage, ExportWorkerResponse, MosaicTrack, VideoMeta, ExportSettings } from '../engine/types';
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function postProgress(current: number, total: number): void {
  const resp: ExportWorkerResponse = { type: 'progress', current, total };
  self.postMessage(resp);
}

/**
 * Build a raw AVCDecoderConfigurationRecord (the binary payload that
 * VideoDecoder expects in `description`) from mp4box's parsed avcC box.
 * mp4box v0.5.x stores SPS/PPS as `SPS`/`PPS` (not `SPSs`/`PPSs`).
 */
function buildAVCDescription(avcC: {
  configurationVersion: number;
  AVCProfileIndication: number;
  profile_compatibility: number;
  AVCLevelIndication: number;
  lengthSizeMinusOne: number;
  SPS: Array<{ length: number; nalu: Uint8Array }>;
  PPS: Array<{ length: number; nalu: Uint8Array }>;
}): Uint8Array {
  let size = 6;
  for (const sps of avcC.SPS) size += 2 + sps.nalu.byteLength;
  size += 1;
  for (const pps of avcC.PPS) size += 2 + pps.nalu.byteLength;

  const buf = new Uint8Array(size);
  let o = 0;
  buf[o++] = avcC.configurationVersion;
  buf[o++] = avcC.AVCProfileIndication;
  buf[o++] = avcC.profile_compatibility;
  buf[o++] = avcC.AVCLevelIndication;
  buf[o++] = 0xfc | (avcC.lengthSizeMinusOne & 0x03);
  buf[o++] = 0xe0 | (avcC.SPS.length & 0x1f);
  for (const sps of avcC.SPS) {
    buf[o++] = (sps.nalu.byteLength >> 8) & 0xff;
    buf[o++] = sps.nalu.byteLength & 0xff;
    buf.set(sps.nalu, o);
    o += sps.nalu.byteLength;
  }
  buf[o++] = avcC.PPS.length & 0xff;
  for (const pps of avcC.PPS) {
    buf[o++] = (pps.nalu.byteLength >> 8) & 0xff;
    buf[o++] = pps.nalu.byteLength & 0xff;
    buf.set(pps.nalu, o);
    o += pps.nalu.byteLength;
  }
  return buf;
}

// ─── main export logic ────────────────────────────────────────────────────────

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

    // ── codec strings ────────────────────────────────────────────────────────
    // Use high-level codec strings to avoid resolution limit errors.
    // avc1.640033 = H.264 High Profile Level 5.1 (supports up to 4K@30fps).
    // vp09.00.51.08 = VP9 Profile 0 Level 5.1.
    // av01.0.13M.08 = AV1 Main Profile Level 4.1.
    type MuxerCodec = 'avc' | 'vp9' | 'av1';
    let encoderCodec = 'avc1.640033';
    let muxerCodec: MuxerCodec = 'avc';
    if (settings.videoCodec === 'vp09') {
      encoderCodec = 'vp09.00.51.08';
      muxerCodec = 'vp9';
    } else if (settings.videoCodec === 'av01') {
      encoderCodec = 'av01.0.13M.08';
      muxerCodec = 'av1';
    }

    // ── renderer ─────────────────────────────────────────────────────────────
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
    const frameDuration = 1 / fps;

    // ── muxer ────────────────────────────────────────────────────────────────
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: muxerCodec,   // BUG-F3 fix: use derived codec key
        width: meta.width,
        height: meta.height,
      },
      fastStart: 'in-memory',
    });

    // ── encoder ──────────────────────────────────────────────────────────────
    let encodedCount = 0;
    const encoder = new VideoEncoder({
      output: (chunk: EncodedVideoChunk, chunkMeta?: EncodedVideoChunkMetadata) => {
        muxer.addVideoChunk(chunk, chunkMeta);
        encodedCount++;
      },
      error: (e: Error) => logger.error('export-worker:encoder-error', e),
    });
    encoder.configure({
      codec: encoderCodec,
      width: meta.width,
      height: meta.height,
      bitrate: settings.bitrateMode === 'manual' && settings.bitrate ? settings.bitrate : 8_000_000,
      framerate: fps,
      latencyMode: 'quality',
    });

    // ── frame processing queue ───────────────────────────────────────────────
    let frameIndex = 0;
    let totalFrames = 0;
    const frameQueue: Array<{ frame: VideoFrame; timestamp: number }> = [];
    let processingActive = false;

    async function drainFrameQueue(): Promise<void> {
      if (processingActive) return;
      processingActive = true;
      try {
        while (frameQueue.length > 0 && !cancelled) {
          const item = frameQueue.shift()!;
          const { frame, timestamp } = item;
          try {
            let processedBitmap: ImageBitmap;
            if (useWebGL && renderer) {
              renderer.renderFrame(frame, tracks, timestamp);
              processedBitmap = await renderer.readPixels();
            } else {
              const offscreen = new OffscreenCanvas(meta.width, meta.height);
              const ctx = offscreen.getContext('2d')!;
              ctx.drawImage(frame, 0, 0);
              applyMosaicCanvas2D(
                ctx as unknown as OffscreenCanvasRenderingContext2D,
                tracks,
                timestamp,
                meta.width,
                meta.height,
              );
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
            if (frameIndex % 5 === 0) {
              postProgress(frameIndex, totalFrames || frameIndex);
            }
          } finally {
            frame.close();
          }
        }
      } finally {
        processingActive = false;
      }
    }

    // ── decoder ──────────────────────────────────────────────────────────────
    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        const ts = frame.timestamp / 1_000_000;
        frameQueue.push({ frame, timestamp: ts });
        drainFrameQueue().catch((e) => logger.error('export-worker:drain-error', e));
      },
      error: (e: Error) => logger.error('export-worker:decoder-error', e),
    });

    // ── mp4box demux ─────────────────────────────────────────────────────────
    // BUG-F1 fix: use a Promise that only resolves after ALL samples have
    // been sent to the decoder, decoded, and the encoder has been flushed.
    // BUG-F2 fix: extract avcC description and pass it to decoder.configure.
    const mp4file = MP4Box.createFile();

    await new Promise<void>((resolve, reject) => {
      let allSamplesSent = false;

      mp4file.onReady = (info: {
        videoTracks: Array<{ id: number; codec: string; nb_samples?: number }>;
      }) => {
        const track = info.videoTracks[0];
        if (!track) { reject(new Error('No video track found')); return; }

        totalFrames = track.nb_samples ?? 0;

        // BUG-F2 fix: extract codec description for H.264
        let description: Uint8Array | undefined;
        try {
          // mp4file.moov.traks is an array; find by track_id
          const traks = (mp4file as unknown as {
            moov: { traks: Array<{ tkhd: { track_id: number }; mdia: { minf: { stbl: { stsd: { entries: Array<{ avcC?: unknown; hvcC?: unknown }> } } } } }> };
          }).moov.traks;
          const trak = traks?.find((t) => t.tkhd.track_id === track.id);
          const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
          const avcC = entry?.avcC as Parameters<typeof buildAVCDescription>[0] | undefined;
          if (avcC?.SPS && avcC.SPS.length > 0) {
            description = buildAVCDescription(avcC);
            logger.debug('export-worker:avcC-extracted', { spsCount: avcC.SPS.length });
          }
        } catch (e) {
          logger.warn('export-worker:avcC-extract-failed', e);
        }

        decoder.configure({
          codec: track.codec,
          codedWidth: meta.width,
          codedHeight: meta.height,
          ...(description ? { description } : {}),
        });

        // Use a large nbSamples so all samples arrive in as few batches as possible
        mp4file.setExtractionOptions(track.id, null, { nbSamples: 1_000_000 });
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
        if (allSamplesSent) return; // guard against duplicate calls

        if (totalFrames === 0) totalFrames = samples.length;

        for (const sample of samples) {
          if (cancelled) break;
          decoder.decode(
            new EncodedVideoChunk({
              type: sample.is_sync ? 'key' : 'delta',
              timestamp: (sample.dts / sample.timescale) * 1_000_000,
              duration: (sample.duration / sample.timescale) * 1_000_000,
              data: sample.data,
            }),
          );
        }

        // BUG-F1 fix: only finalize after the last sample batch
        const lastNum = samples[samples.length - 1]?.number ?? -1;
        const isLastBatch = cancelled ||
          (totalFrames > 0 && lastNum >= totalFrames - 1);

        if (!isLastBatch) return; // more batches may come — do NOT resolve yet

        allSamplesSent = true;

        // Flush decoder → all pending frames will land in the queue
        await decoder.flush().catch((e) => logger.warn('decoder flush warn', e));

        // Wait for frame queue to fully drain
        while ((frameQueue.length > 0 || processingActive) && !cancelled) {
          await sleep(16);
        }

        if (cancelled) {
          resolve();
          return;
        }

        // Post final progress
        postProgress(frameIndex, totalFrames || frameIndex);

        // Flush encoder → all encoded chunks land in the muxer
        await encoder.flush().catch((e) => logger.warn('encoder flush warn', e));
        muxer.finalize();
        resolve();
      };

      mp4file.onError = (e: Error) => reject(e);

      const buf = videoData as ArrayBuffer & { fileStart?: number };
      buf.fileStart = 0;
      mp4file.appendBuffer(buf);
      mp4file.flush();
    });

    encoder.close();
    decoder.close();
    renderer?.dispose();

    if (cancelled) {
      self.postMessage({ type: 'cancelled' } as ExportWorkerResponse);
      return;
    }

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    self.postMessage({
      type: 'done',
      blob,
      fileName: getOutputFileName('output', settings.outputFileSuffix),
    } as ExportWorkerResponse);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } as ExportWorkerResponse);
  }
}
