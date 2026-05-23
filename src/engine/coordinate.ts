// Convert between video-native coordinates and display coordinates

export function videoToDisplay(
  videoX: number,
  videoY: number,
  videoWidth: number,
  videoHeight: number,
  displayWidth: number,
  displayHeight: number,
): { x: number; y: number } {
  return {
    x: (videoX / videoWidth) * displayWidth,
    y: (videoY / videoHeight) * displayHeight,
  };
}

export function displayToVideo(
  displayX: number,
  displayY: number,
  videoWidth: number,
  videoHeight: number,
  displayWidth: number,
  displayHeight: number,
): { x: number; y: number } {
  return {
    x: (displayX / displayWidth) * videoWidth,
    y: (displayY / displayHeight) * videoHeight,
  };
}

export function scaleRect(
  x: number,
  y: number,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: x * scaleX,
    y: y * scaleY,
    width: width * scaleX,
    height: height * scaleY,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
