export function generateId(): string {
  return crypto.randomUUID();
}

export function getOutputFileName(sourceFileName: string, suffix: string): string {
  const dot = sourceFileName.lastIndexOf('.');
  if (dot === -1) return sourceFileName + suffix;
  return sourceFileName.slice(0, dot) + suffix + sourceFileName.slice(dot);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoke after a short delay to allow download to start
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
