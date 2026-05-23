export type VideoMeta = {
  width: number;
  height: number;
  duration: number;
  fps: number | null;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
};

export type MosaicKeyframe = {
  id: string;
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
};

export type MosaicTrack = {
  id: string;
  name: string;
  enabled: boolean;
  mosaicSize: number;
  shape: 'rect';
  keyframes: MosaicKeyframe[];
};

export type ExportQuality = 'highest' | 'high' | 'medium' | 'low';

export type ExportSettings = {
  outputFileSuffix: string;
  videoCodec: 'avc1' | 'vp09' | 'av01' | 'auto';
  quality: ExportQuality;
  trimStartFrames: number;
  trimEndFrames: number;
  previewScale: number;
};

export const defaultExportSettings: ExportSettings = {
  outputFileSuffix: '_mosaic',
  videoCodec: 'auto',
  quality: 'high',
  trimStartFrames: 0,
  trimEndFrames: 0,
  previewScale: 0.5,
};

export type Project = {
  id: string;
  name: string;
  sourceFileName: string;
  sourceVideoMeta: VideoMeta;
  tracks: MosaicTrack[];
  exportSettings: ExportSettings;
  createdAt: string;
  updatedAt: string;
};

export type Capability = {
  webCodecs: boolean;
  videoDecoder: boolean;
  videoEncoder: boolean;
  offscreenCanvas: boolean;
  webgl2: boolean;
  webgpu: boolean;
  worker: boolean;
};

export interface MosaicRenderer {
  init(width: number, height: number): Promise<void>;
  renderFrame(
    input: VideoFrame | ImageBitmap,
    tracks: MosaicTrack[],
    time: number,
  ): Promise<ImageBitmap>;
  dispose(): void;
}

// Worker message types
export type RenderWorkerMessage =
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number }
  | { type: 'renderFrame'; videoTime: number; tracks: MosaicTrack[] }
  | { type: 'dispose' };

export type RenderWorkerResponse =
  | { type: 'ready' }
  | { type: 'frameRendered' }
  | { type: 'error'; message: string };

export type ExportWorkerMessage =
  | {
      type: 'start';
      videoData: ArrayBuffer;
      tracks: MosaicTrack[];
      settings: ExportSettings;
      meta: VideoMeta;
    }
  | { type: 'cancel' };

export type ExportWorkerResponse =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; blob: Blob; fileName: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' };

export type InterpolatedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
};
