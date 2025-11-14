import path from 'node:path';

export function filesRoot(): string {
  return path.resolve(process.env.FILES_ROOT || 'downloads');
}

export function absFromRel(rel: string): string {
  return path.resolve(filesRoot(), rel);
}

export function relFromAbs(absPath: string): string {
  return path.relative(filesRoot(), absPath);
}

export function joinFiles(...parts: string[]): string {
  return path.join(filesRoot(), ...parts);
}

