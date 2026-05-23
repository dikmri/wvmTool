import { writable } from 'svelte/store';
import type { Capability } from '../../engine/types';

export const selectedTrackId = writable<string | null>(null);
export const selectedKeyframeId = writable<string | null>(null);

export type ExportStatus = 'idle' | 'exporting' | 'done' | 'error' | 'cancelled';

export const exportStatus = writable<ExportStatus>('idle');
export const exportProgress = writable<{ current: number; total: number }>({ current: 0, total: 0 });
export const exportError = writable<string | null>(null);

export const capability = writable<Capability | null>(null);

export type DrawingMode = 'select' | 'draw';
export const drawingMode = writable<DrawingMode>('select');
