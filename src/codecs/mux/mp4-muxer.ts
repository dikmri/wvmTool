import { logger } from '../../utils/logger';

export type MuxChunkCallback = (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined) => void;

export interface MP4MuxerWrapper {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  finalize(): Promise<Blob>;
}

export async function createMP4Muxer(
  width: number,
  height: number,
  fps: number,
): Promise<MP4MuxerWrapper> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  });

  return {
    addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
      muxer.addVideoChunk(chunk, meta);
    },
    async finalize(): Promise<Blob> {
      muxer.finalize();
      logger.info('muxer:finalized', { bufferSize: target.buffer.byteLength });
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
  };
}
