import type { VideoMeta } from '../../engine/types';
import { logger } from '../../utils/logger';

export type DecodedFrameCallback = (frame: VideoFrame, timestamp: number) => void;

export async function decodeVideoFrames(
  videoData: ArrayBuffer,
  meta: VideoMeta,
  onFrame: DecodedFrameCallback,
  onProgress?: (decoded: number) => void,
): Promise<void> {
  // Dynamic import of mp4box
  const MP4Box = (await import('mp4box')).default;

  return new Promise<void>((resolve, reject) => {
    const mp4file = MP4Box.createFile();
    const frames: { data: ArrayBuffer; timestamp: number; duration: number; isKey: boolean }[] = [];
    let totalFrames = 0;
    let decodedCount = 0;

    let decoder: VideoDecoder | null = null;

    mp4file.onReady = (info: { videoTracks: { id: number; codec: string }[] }) => {
      logger.info('decoder:mp4-ready', { tracks: info.videoTracks.length });

      const track = info.videoTracks[0];
      if (!track) {
        reject(new Error('No video track found'));
        return;
      }

      const config: VideoDecoderConfig = {
        codec: track.codec,
        codedWidth: meta.width,
        codedHeight: meta.height,
        description: mp4file.getTrackById(track.id)?.trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC
          ? getAVCDecoderConfig(mp4file, track.id)
          : undefined,
      };

      decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          const ts = frame.timestamp / 1_000_000;
          onFrame(frame, ts);
          decodedCount++;
          onProgress?.(decodedCount);
          if (decodedCount >= totalFrames) {
            resolve();
          }
        },
        error: (e: Error) => {
          logger.error('decoder:error', e);
          reject(e);
        },
      });

      decoder.configure(config);
      mp4file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      mp4file.start();
    };

    mp4file.onSamples = (
      _trackId: number,
      _ref: unknown,
      samples: Array<{
        data: Uint8Array;
        dts: number;
        duration: number;
        is_sync: boolean;
        timescale: number;
      }>,
    ) => {
      totalFrames += samples.length;
      for (const sample of samples) {
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.dts / sample.timescale) * 1_000_000,
          duration: (sample.duration / sample.timescale) * 1_000_000,
          data: sample.data,
        });
        decoder?.decode(chunk);
      }
      decoder?.flush().catch(reject);
    };

    mp4file.onError = (e: Error) => {
      logger.error('decoder:mp4-error', e);
      reject(e);
    };

    const buf = videoData as ArrayBuffer & { fileStart?: number };
    buf.fileStart = 0;
    mp4file.appendBuffer(buf);
    mp4file.flush();
  });
}

function getAVCDecoderConfig(mp4file: ReturnType<typeof import('mp4box').default.createFile>, trackId: number): Uint8Array | undefined {
  try {
    const track = mp4file.getTrackById(trackId);
    const avcC = track?.trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC;
    if (!avcC) return undefined;
    const box = mp4file.getTrackById(trackId);
    const description = box?.trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    if (!description) return undefined;
    const stream = { buffer: new ArrayBuffer(1024), byteOffset: 0 };
    description.write?.(stream);
    return new Uint8Array(stream.buffer, 0, stream.byteOffset);
  } catch {
    return undefined;
  }
}
