import en from './en.ts';
import zh from './zh.ts';

export const languages = { en: 'English', zh: '中文' } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = 'en';

const translations = { en, zh } as const;

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang in translations) return lang as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return translations[lang];
}

export function getLocalizedPath(lang: Lang, path: string = ''): string {
  return lang === defaultLang ? `/${path}` : `/${lang}/${path}`;
}
