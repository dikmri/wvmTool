import { writable, derived } from 'svelte/store';

export const currentTime = writable<number>(0);
export const isPlaying = writable<boolean>(false);
export const duration = writable<number>(0);
export const fps = writable<number>(30);

export const trimStartTime = writable<number>(0);
export const trimEndTime = writable<number>(0);
export const loopPlayback = writable<boolean>(true);

// Shared reference to the active <video> element. Set by VideoViewport after load.
export const videoElement = writable<HTMLVideoElement | null>(null);

export const currentFrame = derived(
  [currentTime, fps],
  ([$t, $fps]) => Math.round($t * $fps),
);

export const totalFrames = derived(
  [duration, fps],
  ([$d, $fps]) => Math.round($d * $fps),
);
