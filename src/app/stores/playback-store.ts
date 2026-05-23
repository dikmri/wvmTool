import { writable, derived } from 'svelte/store';

export const currentTime = writable<number>(0);
export const isPlaying = writable<boolean>(false);
export const duration = writable<number>(0);
export const fps = writable<number>(30);

export const currentFrame = derived(
  [currentTime, fps],
  ([$t, $fps]) => Math.round($t * $fps),
);

export const totalFrames = derived(
  [duration, fps],
  ([$d, $fps]) => Math.round($d * $fps),
);
