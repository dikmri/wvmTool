import type { ExportWorkerMessage, ExportWorkerResponse, MosaicTrack, VideoMeta, ExportSettings } from '../engine/types';
import { logger } from '../utils/logger';
import { getOutputFileName } from '../utils/file';
import { WebGL2MosaicRenderer } from '../render/webgl/gl-context';
import { applyMosaicCanvas2D } from '../render/canvas/canvas2d-fallback';

let cancelled = false;

self.onmessage = async (e: MessageEvent<ExportWorkerMessage>) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type === 'start') {
    await runExport(msg.videoData, msg.tracks, msg.settings, msg.meta);
  }
};

// ─── ユーティリティ ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function postProgress(current: number, total: number): void {
  self.postMessage({ type: 'progress', current, total } as ExportWorkerResponse);
}

/**
 * 画質プリセット → AVC quantizer 値（低いほど高画質）
 * 参考: ffmpeg CRF スケール相当
 */
const QUALITY_TO_QUANTIZER: Record<string, number> = {
  highest: 16,
  high:    22,
  medium:  28,
  low:     35,
};

/**
 * quantizer 非対応時の CBR フォールバックビットレート（bps）
 * 十分に高いビットレートを指定して画質を担保する
 */
const QUALITY_TO_BITRATE: Record<string, number> = {
  highest: 50_000_000,
  high:    25_000_000,
  medium:  12_000_000,
  low:      6_000_000,
};

/**
 * AVCDecoderConfigurationRecord を mp4box の avcC ボックスから組み立てる。
 * mp4box v0.5.x では SPS/PPS（SPSs/PPSs ではない）。
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
    buf.set(sps.nalu, o); o += sps.nalu.byteLength;
  }
  buf[o++] = avcC.PPS.length & 0xff;
  for (const pps of avcC.PPS) {
    buf[o++] = (pps.nalu.byteLength >> 8) & 0xff;
    buf[o++] = pps.nalu.byteLength & 0xff;
    buf.set(pps.nalu, o); o += pps.nalu.byteLength;
  }
  return buf;
}

/** AAC AudioSpecificConfig を mp4box 内部構造から取り出す */
function extractAudioSpecificConfig(mp4file: unknown, trackId: number): Uint8Array | undefined {
  try {
    const traks = (mp4file as {
      moov?: { traks?: Array<{
        tkhd: { track_id: number };
        mdia: { minf: { stbl: { stsd: { entries: Array<{ esds?: unknown }> } } } };
      }> };
    }).moov?.traks;
    const trak = traks?.find((t) => t.tkhd.track_id === trackId);
    const esds = (trak?.mdia?.minf?.stbl?.stsd?.entries?.[0] as { esds?: { esd?: { descs?: unknown[] } } })?.esds;
    if (!esds?.esd?.descs) return undefined;
    function findData(descs: unknown[]): Uint8Array | undefined {
      for (const d of descs) {
        const desc = d as { data?: unknown; descs?: unknown[] };
        if (desc.data instanceof Uint8Array) return desc.data;
        if (Array.isArray(desc.descs)) { const f = findData(desc.descs); if (f) return f; }
      }
    }
    return findData(esds.esd.descs);
  } catch { return undefined; }
}

// ─── エクスポート本体 ──────────────────────────────────────────────────────────

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

    // ── コーデック ────────────────────────────────────────────────────────────
    type MuxerCodec = 'avc' | 'vp9' | 'av1';
    let encoderCodec = 'avc1.640033'; // H.264 High Profile Level 5.1
    let muxerCodec: MuxerCodec = 'avc';
    if (settings.videoCodec === 'vp09') { encoderCodec = 'vp09.00.51.08'; muxerCodec = 'vp9'; }
    else if (settings.videoCodec === 'av01') { encoderCodec = 'av01.0.13M.08'; muxerCodec = 'av1'; }

    // ── 画質設定 ──────────────────────────────────────────────────────────────
    const quantizerValue = QUALITY_TO_QUANTIZER[settings.quality] ?? 22;
    const fallbackBitrate = QUALITY_TO_BITRATE[settings.quality] ?? 25_000_000;

    // ── quantizer モードのサポート確認 ────────────────────────────────────────
    // prefer-software を指定して OpenH264 等のソフトウェアエンコーダーで確認する。
    // Windows の Media Foundation ハードウェアエンコーダーは quantizer を無視することがあるため。
    let useQuantizer = false;
    try {
      const check = await VideoEncoder.isConfigSupported({
        codec: encoderCodec,
        width: meta.width,
        height: meta.height,
        bitrateMode: 'quantizer',
        framerate: meta.fps ?? 30,
        latencyMode: 'quality',
        hardwareAcceleration: 'prefer-software',
      });
      useQuantizer = check.supported === true;
    } catch { useQuantizer = false; }
    logger.info('export-worker:quantizer-support', { supported: useQuantizer, quantizer: quantizerValue, codec: muxerCodec });

    // ── レンダラー ────────────────────────────────────────────────────────────
    let renderer: WebGL2MosaicRenderer | null = null;
    let useWebGL = false;
    try {
      const offscreen = new OffscreenCanvas(meta.width, meta.height);
      renderer = new WebGL2MosaicRenderer(offscreen);
      await renderer.init(meta.width, meta.height);
      useWebGL = true;
    } catch { logger.warn('export-worker:webgl2-unavailable', 'Canvas2D フォールバックを使用'); }

    // ── 状態変数 ──────────────────────────────────────────────────────────────
    const target = new ArrayBufferTarget();
    let muxer: InstanceType<typeof Muxer<typeof target>> | null = null;
    let encoder: VideoEncoder | null = null;
    let frameIndex = 0;
    let totalFrames = 0;
    const frameQueue: Array<{ frame: VideoFrame; timestamp: number }> = [];
    let processingActive = false;
    const pendingAudioChunks: Array<{ chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }> = [];

    // onReady で確定した fps をクロージャー越しに drainFrameQueue に届ける
    let detectedFps = meta.fps ?? 30;

    // ── フレームキュー処理 ────────────────────────────────────────────────────
    async function drainFrameQueue(): Promise<void> {
      if (processingActive) return;
      processingActive = true;
      try {
        while (frameQueue.length > 0 && !cancelled) {
          const { frame, timestamp } = frameQueue.shift()!;
          try {
            let processedBitmap: ImageBitmap;
            if (useWebGL && renderer) {
              renderer.renderFrame(frame, tracks, timestamp);
              processedBitmap = await renderer.readPixels();
            } else {
              const offscreen = new OffscreenCanvas(meta.width, meta.height);
              const ctx = offscreen.getContext('2d')!;
              ctx.drawImage(frame, 0, 0);
              applyMosaicCanvas2D(ctx as unknown as OffscreenCanvasRenderingContext2D, tracks, timestamp, meta.width, meta.height);
              processedBitmap = await createImageBitmap(offscreen);
            }

            const frameDuration = 1 / detectedFps;
            const outputFrame = new VideoFrame(processedBitmap, {
              timestamp: Math.round(timestamp * 1_000_000),
              duration: Math.round(frameDuration * 1_000_000),
            });
            const isKey = frameIndex % Math.round(detectedFps * 2) === 0;

            // per-frame quantizer 指定（コーデック別に型が異なるため as any キャストを使用）
            const encOpts: VideoEncoderEncodeOptions = { keyFrame: isKey };
            if (useQuantizer) {
              if (muxerCodec === 'avc') encOpts.avc = { quantizer: quantizerValue };
              else if (muxerCodec === 'vp9') (encOpts as unknown as { vp9: { quantizer: number } }).vp9 = { quantizer: quantizerValue };
              else if (muxerCodec === 'av1') (encOpts as unknown as { av1: { quantizer: number } }).av1 = { quantizer: quantizerValue };
            }
            encoder!.encode(outputFrame, encOpts);

            outputFrame.close();
            processedBitmap.close();
            frameIndex++;
            if (frameIndex % 5 === 0) postProgress(frameIndex, totalFrames || frameIndex);
          } finally {
            frame.close();
          }
        }
      } finally { processingActive = false; }
    }

    // ── デコーダー ────────────────────────────────────────────────────────────
    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        frameQueue.push({ frame, timestamp: frame.timestamp / 1_000_000 });
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
        videoTracks: Array<{
          id: number; codec: string;
          nb_samples?: number; duration?: number; timescale?: number; bitrate?: number;
        }>;
        audioTracks?: Array<{
          id: number; codec: string;
          audio: { sample_rate: number; channel_count: number };
        }>;
      }) => {
        const vTrack = info.videoTracks[0];
        if (!vTrack) { reject(new Error('映像トラックが見つかりません')); return; }
        videoTrackId = vTrack.id;
        totalFrames = vTrack.nb_samples ?? 0;

        // ── 実際の fps を mp4box から計算 ──────────────────────────────────────
        if (vTrack.nb_samples && vTrack.duration && vTrack.timescale) {
          const durationSec = vTrack.duration / vTrack.timescale;
          const computed = vTrack.nb_samples / durationSec;
          if (computed > 1 && computed < 300) {
            detectedFps = Math.round(computed * 100) / 100;
          }
        }
        logger.info('export-worker:detected-fps', { detectedFps, totalFrames });

        // ── 音声 ─────────────────────────────────────────────────────────────
        const aTrack = info.audioTracks?.[0];
        if (aTrack) audioTrackId = aTrack.id;
        let audioDescription: Uint8Array | undefined;
        if (aTrack) audioDescription = extractAudioSpecificConfig(mp4file, aTrack.id);

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

        // ── エンコーダー設定 ──────────────────────────────────────────────────
        encoder = new VideoEncoder({
          output: (chunk: EncodedVideoChunk, chunkMeta?: EncodedVideoChunkMetadata) => {
            muxer!.addVideoChunk(chunk, chunkMeta);
          },
          error: (e: Error) => logger.error('export-worker:encoder-error', e),
        });

        if (useQuantizer) {
          // quantizer モード: 品質を直接制御（ffmpeg -crf 相当）
          // prefer-software でソフトウェアエンコーダー（OpenH264 等）を使用し、
          // Windows Media Foundation ハードウェアエンコーダーによる画質劣化を回避する
          encoder.configure({
            codec: encoderCodec,
            width: meta.width,
            height: meta.height,
            bitrateMode: 'quantizer',
            framerate: detectedFps,
            latencyMode: 'quality',
            hardwareAcceleration: 'prefer-software',
          });
          logger.info('export-worker:encoder-configured', { mode: 'quantizer', quantizer: quantizerValue, fps: detectedFps, hw: 'prefer-software' });
        } else {
          // フォールバック: 高ビットレート CBR（quantizer 非対応環境向け）
          encoder.configure({
            codec: encoderCodec,
            width: meta.width,
            height: meta.height,
            bitrate: fallbackBitrate,
            bitrateMode: 'constant',
            framerate: detectedFps,
            latencyMode: 'quality',
            hardwareAcceleration: 'prefer-software',
          });
          logger.info('export-worker:encoder-configured', { mode: 'cbr', bitrate: fallbackBitrate, fps: detectedFps, hw: 'prefer-software' });
        }

        // ── デコーダー設定 ────────────────────────────────────────────────────
        let description: Uint8Array | undefined;
        try {
          const traks = (mp4file as unknown as {
            moov: { traks: Array<{ tkhd: { track_id: number }; mdia: { minf: { stbl: { stsd: { entries: Array<{ avcC?: unknown }> } } } } }> };
          }).moov.traks;
          const trak = traks?.find((t) => t.tkhd.track_id === vTrack.id);
          const avcC = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC as Parameters<typeof buildAVCDescription>[0] | undefined;
          if (avcC?.SPS?.length) description = buildAVCDescription(avcC);
        } catch (e) { logger.warn('export-worker:avcC-extract-failed', e); }

        decoder.configure({
          codec: vTrack.codec,
          codedWidth: meta.width,
          codedHeight: meta.height,
          ...(description ? { description } : {}),
        });

        // 音声の最初のチャンクに付けるデコーダーコンフィグ
        if (aTrack && audioDescription) {
          (mp4file as unknown as { _audioFirstMeta: EncodedAudioChunkMetadata })._audioFirstMeta = {
            decoderConfig: {
              codec: 'mp4a.40.2',
              sampleRate: aTrack.audio.sample_rate,
              numberOfChannels: aTrack.audio.channel_count,
              description: audioDescription,
            },
          };
        }

        mp4file.setExtractionOptions(videoTrackId, null, { nbSamples: 1_000_000 });
        if (audioTrackId !== -1) mp4file.setExtractionOptions(audioTrackId, null, { nbSamples: 1_000_000 });
        mp4file.start();
      };

      mp4file.onSamples = async (
        id: number,
        _ref: unknown,
        samples: Array<{
          data: Uint8Array; dts: number; duration: number;
          is_sync: boolean; timescale: number; number?: number;
        }>,
      ) => {
        // ── 音声パススルー ────────────────────────────────────────────────────
        if (id === audioTrackId) {
          const firstMeta = (mp4file as unknown as { _audioFirstMeta?: EncodedAudioChunkMetadata })._audioFirstMeta;
          samples.forEach((sample, i) => {
            pendingAudioChunks.push({
              chunk: new EncodedAudioChunk({
                type: 'key',
                timestamp: (sample.dts / sample.timescale) * 1_000_000,
                duration: (sample.duration / sample.timescale) * 1_000_000,
                data: sample.data,
              }),
              meta: i === 0 && firstMeta ? firstMeta : undefined,
            });
          });
          (mp4file as unknown as { _audioFirstMeta?: unknown })._audioFirstMeta = undefined;
          return;
        }

        // ── 映像処理 ──────────────────────────────────────────────────────────
        if (id !== videoTrackId || allSamplesSent) return;
        if (totalFrames === 0) totalFrames = samples.length;

        for (const sample of samples) {
          if (cancelled) break;
          decoder.decode(new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: (sample.dts / sample.timescale) * 1_000_000,
            duration: (sample.duration / sample.timescale) * 1_000_000,
            data: sample.data,
          }));
        }

        const lastNum = samples[samples.length - 1]?.number ?? -1;
        if (!cancelled && !(totalFrames > 0 && lastNum >= totalFrames - 1)) return;

        allSamplesSent = true;
        await decoder.flush().catch((e) => logger.warn('decoder flush warn', e));

        while ((frameQueue.length > 0 || processingActive) && !cancelled) {
          await sleep(16);
        }
        if (cancelled) { resolve(); return; }

        postProgress(frameIndex, totalFrames || frameIndex);
        await encoder!.flush().catch((e) => logger.warn('encoder flush warn', e));

        // 音声チャンクをまとめてから finalize
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
