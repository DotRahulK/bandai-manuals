import path from 'node:path';

export function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function sanitizeFilename(input: string): string {
  const base = input
    .replace(/[\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'file';
}

export function ensureAbsoluteUrl(baseUrl: string, href: string | undefined | null): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, baseUrl);
    return url.toString();
  } catch {
    return null;
  }
}

export function urlBasename(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const last = path.posix.basename(u.pathname);
    return last || 'index.html';
  } catch {
    return 'file';
  }
}

export function matchesAny(value: string, patterns?: (string | RegExp)[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (value.includes(p)) return true;
    } else if (p instanceof RegExp) {
      if (p.test(value)) return true;
    }
  }
  return false;
}

export function matchesNone(value: string, patterns?: (string | RegExp)[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (value.includes(p)) return false;
    } else if (p instanceof RegExp) {
      if (p.test(value)) return false;
    }
  }
  return true;
}

// Sanitize a string to be used as a Supabase Storage key segment (ASCII-friendly)
export function sanitizeStorageKeyPart(input: string): string {
  const romanMap: Record<string, string> = {
    'Ⅰ': 'I',
    'Ⅱ': 'II',
    'Ⅲ': 'III',
    'Ⅳ': 'IV',
    'Ⅴ': 'V',
    'Ⅵ': 'VI',
    'Ⅶ': 'VII',
    'Ⅷ': 'VIII',
    'Ⅸ': 'IX',
    'Ⅹ': 'X'
  };
  let s = input.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, (ch) => romanMap[ch] || ch);
  // Remove diacritics and convert to ASCII-safe set
  s = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks
    .replace(/[^A-Za-z0-9._ \-]+/g, '-') // non-ASCII or disallowed
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^[-. ]+|[-. ]+$/g, '');
  return s || 'file';
}
