import { writable, derived } from 'svelte/store';
import type { Project, MosaicTrack, MosaicKeyframe, VideoMeta, ExportSettings } from '../../engine/types';
import { defaultExportSettings } from '../../engine/types';
import { generateId } from '../../utils/file';

function createProjectStore() {
  const { subscribe, set, update } = writable<Project | null>(null);

  return {
    subscribe,

    initProject(fileName: string, meta: VideoMeta): void {
      set({
        id: generateId(),
        name: fileName,
        sourceFileName: fileName,
        sourceVideoMeta: meta,
        tracks: [],
        exportSettings: { ...defaultExportSettings },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },

    addTrack(): void {
      update((p) => {
        if (!p) return p;
        const track: MosaicTrack = {
          id: generateId(),
          name: `Track ${p.tracks.length + 1}`,
          enabled: true,
          mosaicSize: 20,
          shape: 'rect',
          keyframes: [],
        };
        return { ...p, tracks: [...p.tracks, track], updatedAt: new Date().toISOString() };
      });
    },

    removeTrack(trackId: string): void {
      update((p) => {
        if (!p) return p;
        return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), updatedAt: new Date().toISOString() };
      });
    },

    toggleTrack(trackId: string): void {
      update((p) => {
        if (!p) return p;
        return {
          ...p,
          tracks: p.tracks.map((t) =>
            t.id === trackId ? { ...t, enabled: !t.enabled } : t,
          ),
          updatedAt: new Date().toISOString(),
        };
      });
    },

    setTrackMosaicSize(trackId: string, size: number): void {
      update((p) => {
        if (!p) return p;
        return {
          ...p,
          tracks: p.tracks.map((t) =>
            t.id === trackId ? { ...t, mosaicSize: size } : t,
          ),
          updatedAt: new Date().toISOString(),
        };
      });
    },

    addKeyframe(trackId: string, time: number, x: number, y: number, w: number, h: number): void {
      update((p) => {
        if (!p) return p;
        const kf: MosaicKeyframe = {
          id: generateId(),
          time,
          x,
          y,
          width: w,
          height: h,
        };
        return {
          ...p,
          tracks: p.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  keyframes: [...t.keyframes.filter((k) => Math.abs(k.time - time) > 0.001), kf].sort(
                    (a, b) => a.time - b.time,
                  ),
                }
              : t,
          ),
          updatedAt: new Date().toISOString(),
        };
      });
    },

    removeKeyframe(trackId: string, keyframeId: string): void {
      update((p) => {
        if (!p) return p;
        return {
          ...p,
          tracks: p.tracks.map((t) =>
            t.id === trackId
              ? { ...t, keyframes: t.keyframes.filter((k) => k.id !== keyframeId) }
              : t,
          ),
          updatedAt: new Date().toISOString(),
        };
      });
    },

    updateKeyframe(trackId: string, keyframeId: string, x: number, y: number, w: number, h: number): void {
      update((p) => {
        if (!p) return p;
        return {
          ...p,
          tracks: p.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  keyframes: t.keyframes.map((k) =>
                    k.id === keyframeId ? { ...k, x, y, width: w, height: h } : k,
                  ),
                }
              : t,
          ),
          updatedAt: new Date().toISOString(),
        };
      });
    },

    updateExportSettings(settings: Partial<ExportSettings>): void {
      update((p) => {
        if (!p) return p;
        return {
          ...p,
          exportSettings: { ...p.exportSettings, ...settings },
          updatedAt: new Date().toISOString(),
        };
      });
    },

    reset(): void {
      set(null);
    },
  };
}

export const projectStore = createProjectStore();

export const tracksStore = derived(projectStore, ($p) => $p?.tracks ?? []);
export const exportSettingsStore = derived(projectStore, ($p) => $p?.exportSettings ?? defaultExportSettings);
export const videoMetaStore = derived(projectStore, ($p) => $p?.sourceVideoMeta ?? null);
