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
 * AVCDecoderConfigurationRecord (binary payload for VideoDecoder description).
 * mp4box v0.5.x uses SPS/PPS (not SPSs/PPSs).
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

/** AAC AudioSpecificConfig を mp4box の内部構造から取り出す */
function extractAudioSpecificConfig(mp4file: unknown, trackId: number): Uint8Array | undefined {
  try {
    const traks = (mp4file as { moov?: { traks?: Array<{
      tkhd: { track_id: number };
      mdia: { minf: { stbl: { stsd: { entries: Array<{ esds?: unknown }> } } } };
    }> } }).moov?.traks;
    if (!traks) return undefined;
    const trak = traks.find((t) => t.tkhd.track_id === trackId);
    const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const esds = (entry as { esds?: { esd?: { descs?: unknown[] } } })?.esds;
    if (!esds?.esd?.descs) return undefined;

    function findData(descs: unknown[]): Uint8Array | undefined {
      for (const d of descs) {
        const desc = d as { data?: unknown; descs?: unknown[] };
        if (desc.data instanceof Uint8Array) return desc.data;
        if (Array.isArray(desc.descs)) {
          const found = findData(desc.descs);
          if (found) return found;
        }
      }
      return undefined;
    }
    return findData(esds.esd.descs);
  } catch {
    return undefined;
  }
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

    // ── コーデック文字列 ──────────────────────────────────────────────────────
    type MuxerCodec = 'avc' | 'vp9' | 'av1';
    let encoderCodec = 'avc1.640033'; // H.264 High Profile Level 5.1
    let muxerCodec: MuxerCodec = 'avc';
    if (settings.videoCodec === 'vp09') {
      encoderCodec = 'vp09.00.51.08';
      muxerCodec = 'vp9';
    } else if (settings.videoCodec === 'av01') {
      encoderCodec = 'av01.0.13M.08';
      muxerCodec = 'av1';
    }

    // ── レンダラー ────────────────────────────────────────────────────────────
    let renderer: WebGL2MosaicRenderer | null = null;
    let useWebGL = false;
    try {
      const offscreen = new OffscreenCanvas(meta.width, meta.height);
      renderer = new WebGL2MosaicRenderer(offscreen);
      await renderer.init(meta.width, meta.height);
      useWebGL = true;
    } catch {
      logger.warn('export-worker:webgl2-unavailable', 'Canvas2D フォールバックを使用');
    }

    const fps = meta.fps ?? 30;
    const frameDuration = 1 / fps;

    // ── 状態変数 ──────────────────────────────────────────────────────────────
    const target = new ArrayBufferTarget();
    let muxer: InstanceType<typeof Muxer<typeof target>> | null = null;
    let encoder: VideoEncoder | null = null;
    let encodedCount = 0;
    let frameIndex = 0;
    let totalFrames = 0;
    const frameQueue: Array<{ frame: VideoFrame; timestamp: number }> = [];
    let processingActive = false;
    // 音声チャンクはすべて収集してから muxer に追加（タイミング問題を回避）
    const pendingAudioChunks: Array<{ chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }> = [];

    // ── フレームキュー処理 ────────────────────────────────────────────────────
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
                tracks, timestamp, meta.width, meta.height,
              );
              processedBitmap = await createImageBitmap(offscreen);
            }

            const outputFrame = new VideoFrame(processedBitmap, {
              timestamp: Math.round(timestamp * 1_000_000),
              duration: Math.round(frameDuration * 1_000_000),
            });
            const isKey = frameIndex % Math.round(fps * 2) === 0;
            encoder!.encode(outputFrame, { keyFrame: isKey });
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

    // ── デコーダー ────────────────────────────────────────────────────────────
    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        const ts = frame.timestamp / 1_000_000;
        frameQueue.push({ frame, timestamp: ts });
        drainFrameQueue().catch((e) => logger.error('export-worker:drain-error', e));
      },
      error: (e: Error) => logger.error('export-worker:decoder-error', e),
    });

    // ── mp4box デマックス ─────────────────────────────────────────────────────
    const mp4file = MP4Box.createFile();

    await new Promise<void>((resolve, reject) => {
      let allSamplesSent = false;
      let videoTrackId = -1;
      let audioTrackId = -1;

      mp4file.onReady = (info: {
        videoTracks: Array<{ id: number; codec: string; nb_samples?: number; bitrate?: number }>;
        audioTracks?: Array<{ id: number; codec: string; audio: { sample_rate: number; channel_count: number } }>;
      }) => {
        const vTrack = info.videoTracks[0];
        if (!vTrack) { reject(new Error('映像トラックが見つかりません')); return; }
        videoTrackId = vTrack.id;
        totalFrames = vTrack.nb_samples ?? 0;

        const aTrack = info.audioTracks?.[0];
        if (aTrack) audioTrackId = aTrack.id;

        // ── ビットレート決定：元動画のビットレートを優先 ──────────────────────
        const originalBitrate = (vTrack.bitrate ?? 0);
        let autoBitrate: number;
        if (originalBitrate > 1_000_000) {
          // 元動画のビットレートをそのまま使用（最低 5Mbps）
          autoBitrate = Math.max(originalBitrate, 5_000_000);
        } else {
          // ビットレート情報がない場合は解像度から計算（0.2 bits/pixel/frame）
          autoBitrate = Math.max(Math.round(meta.width * meta.height * fps * 0.2), 5_000_000);
        }
        const bitrate = settings.bitrateMode === 'manual' && settings.bitrate
          ? settings.bitrate
          : autoBitrate;

        // ── 音声設定 ──────────────────────────────────────────────────────────
        let audioDescription: Uint8Array | undefined;
        if (aTrack) {
          audioDescription = extractAudioSpecificConfig(mp4file, aTrack.id);
          logger.debug('export-worker:audio-track', {
            codec: aTrack.codec,
            sampleRate: aTrack.audio.sample_rate,
            channels: aTrack.audio.channel_count,
            hasDescription: !!audioDescription,
          });
        }

        // ── Muxer 作成 ────────────────────────────────────────────────────────
        muxer = new Muxer({
          target,
          video: { codec: muxerCodec, width: meta.width, height: meta.height },
          ...(aTrack ? {
            audio: {
              codec: 'aac',
              sampleRate: aTrack.audio.sample_rate,
              numberOfChannels: aTrack.audio.channel_count,
            },
          } : {}),
          fastStart: 'in-memory',
        });

        // ── エンコーダー作成 ──────────────────────────────────────────────────
        encoder = new VideoEncoder({
          output: (chunk: EncodedVideoChunk, chunkMeta?: EncodedVideoChunkMetadata) => {
            muxer!.addVideoChunk(chunk, chunkMeta);
            encodedCount++;
          },
          error: (e: Error) => logger.error('export-worker:encoder-error', e),
        });
        encoder.configure({
          codec: encoderCodec,
          width: meta.width,
          height: meta.height,
          bitrate,
          framerate: fps,
          latencyMode: 'quality',
        });
        logger.info('export-worker:encoder-configured', { codec: encoderCodec, bitrate, fps });

        // ── デコーダー設定 ────────────────────────────────────────────────────
        let description: Uint8Array | undefined;
        try {
          const traks = (mp4file as unknown as {
            moov: { traks: Array<{ tkhd: { track_id: number }; mdia: { minf: { stbl: { stsd: { entries: Array<{ avcC?: unknown }> } } } } }> };
          }).moov.traks;
          const trak = traks?.find((t) => t.tkhd.track_id === vTrack.id);
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
          codec: vTrack.codec,
          codedWidth: meta.width,
          codedHeight: meta.height,
          ...(description ? { description } : {}),
        });

        // 音声 decoder config（最初のチャンクと共に渡す）
        if (aTrack && audioDescription) {
          const firstMeta: EncodedAudioChunkMetadata = {
            decoderConfig: {
              codec: 'mp4a.40.2',
              sampleRate: aTrack.audio.sample_rate,
              numberOfChannels: aTrack.audio.channel_count,
              description: audioDescription,
            },
          };
          // pendingAudioChunks に先頭チャンクとして差し込むためフラグ保持
          (mp4file as unknown as { _audioFirstMeta: EncodedAudioChunkMetadata })._audioFirstMeta = firstMeta;
        }

        mp4file.setExtractionOptions(videoTrackId, null, { nbSamples: 1_000_000 });
        if (audioTrackId !== -1) {
          mp4file.setExtractionOptions(audioTrackId, null, { nbSamples: 1_000_000 });
        }
        mp4file.start();
      };

      mp4file.onSamples = async (
        id: number,
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
        // ── 音声パススルー ────────────────────────────────────────────────────
        if (id === audioTrackId) {
          const firstMeta = (mp4file as unknown as { _audioFirstMeta?: EncodedAudioChunkMetadata })._audioFirstMeta;
          for (let i = 0; i < samples.length; i++) {
            const sample = samples[i];
            const chunk = new EncodedAudioChunk({
              type: 'key',
              timestamp: (sample.dts / sample.timescale) * 1_000_000,
              duration: (sample.duration / sample.timescale) * 1_000_000,
              data: sample.data,
            });
            pendingAudioChunks.push({
              chunk,
              meta: i === 0 && firstMeta ? firstMeta : undefined,
            });
          }
          (mp4file as unknown as { _audioFirstMeta?: unknown })._audioFirstMeta = undefined;
          return;
        }

        // ── 映像処理 ──────────────────────────────────────────────────────────
        if (id !== videoTrackId) return;
        if (allSamplesSent) return;

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

        const lastNum = samples[samples.length - 1]?.number ?? -1;
        const isLastBatch = cancelled || (totalFrames > 0 && lastNum >= totalFrames - 1);
        if (!isLastBatch) return;

        allSamplesSent = true;

        await decoder.flush().catch((e) => logger.warn('decoder flush warn', e));

        while ((frameQueue.length > 0 || processingActive) && !cancelled) {
          await sleep(16);
        }

        if (cancelled) { resolve(); return; }

        postProgress(frameIndex, totalFrames || frameIndex);
        await encoder!.flush().catch((e) => logger.warn('encoder flush warn', e));

        // 音声チャンクを映像エンコード完了後に追加してからファイナライズ
        for (const { chunk, meta: aMeta } of pendingAudioChunks) {
          muxer!.addAudioChunk(chunk, aMeta);
        }

        muxer!.finalize();
        resolve();
      };

      mp4file.onError = (e: Error) => reject(e);

      const buf = videoData as ArrayBuffer & { fileStart?: number };
      buf.fileStart = 0;
      mp4file.appendBuffer(buf);
      mp4file.flush();
    });

    encoder?.close();
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
