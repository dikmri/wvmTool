import { derived, writable } from 'svelte/store';
import ja from './ja.json';

// 翻訳ファイルは遅延インポートで必要時だけ読み込む
const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('./en.json'),
  zh: () => import('./zh.json'),
  ko: () => import('./ko.json'),
  es: () => import('./es.json'),
  fr: () => import('./fr.json'),
};

export const LOCALES = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
] as const;

export type Locale = (typeof LOCALES)[number]['value'];

const LS_KEY = 'wvm-locale';
const SUPPORTED = LOCALES.map((l) => l.value) as string[];

function detectLocale(): Locale {
  const stored = localStorage.getItem(LS_KEY);
  if (stored && SUPPORTED.includes(stored)) return stored as Locale;
  const nav = navigator.language.split('-')[0];
  return SUPPORTED.includes(nav) ? (nav as Locale) : 'en';
}

// 日本語を初期値に（チラつき防止）
const _dict = writable<Record<string, string>>(ja);

export const locale = writable<Locale>(detectLocale());

locale.subscribe(async (lang) => {
  localStorage.setItem(LS_KEY, lang);
  if (lang === 'ja') {
    _dict.set(ja);
    return;
  }
  try {
    const mod = await LOADERS[lang]?.();
    if (mod?.default) _dict.set(mod.default);
  } catch {
    _dict.set(ja);
  }
});

export const t = derived(_dict, ($d) => (key: string): string => $d[key] ?? key);
