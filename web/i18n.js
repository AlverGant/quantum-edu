/**
 * Internacionalização — as oito línguas mais faladas do mundo, as mesmas do
 * sorteio-quantico (sites irmãos, mesma lista).
 *
 * O árabe é RTL: `dir` vai no <html>; o CSS tem os ajustes. Fórmulas e
 * números ficam LTR (classe .mono força a direção).
 *
 * `intl` é a tag BCP-47 do Intl.NumberFormat, que difere da chave curta
 * (pt -> pt-BR, zh -> zh-CN). `-u-nu-latn` no árabe: sem isso, ar formata
 * números em dígitos indo-arábicos, e k/M/fórmulas já são latinos.
 *
 * Os dicionários vivem em i18n/<lang>.js e são carregados sob demanda —
 * ninguém baixa 8 línguas para ler uma.
 */

export const LOCALES = {
  en: { native: 'English', dir: 'ltr', intl: 'en-US' },
  zh: { native: '中文', dir: 'ltr', intl: 'zh-CN' },
  hi: { native: 'हिन्दी', dir: 'ltr', intl: 'hi-IN' },
  es: { native: 'Español', dir: 'ltr', intl: 'es-ES' },
  ar: { native: 'العربية', dir: 'rtl', intl: 'ar-u-nu-latn' },
  pt: { native: 'Português', dir: 'ltr', intl: 'pt-BR' },
  fr: { native: 'Français', dir: 'ltr', intl: 'fr-FR' },
  ru: { native: 'Русский', dir: 'ltr', intl: 'ru-RU' },
};

export const DEFAULT_LOCALE = 'en';

/** ?lang= > localStorage > idioma do navegador > inglês. */
export function pickLocale() {
  const url = new URL(location.href).searchParams.get('lang');
  if (url && LOCALES[url]) return url;
  const saved = localStorage.getItem('lang');
  if (saved && LOCALES[saved]) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const short = (tag ?? '').slice(0, 2).toLowerCase();
    if (LOCALES[short]) return short;
  }
  return DEFAULT_LOCALE;
}

export async function loadStrings(lang) {
  const mod = await import(`./i18n/${lang}.js`);
  return mod.default;
}

export function switchLocale(lang) {
  localStorage.setItem('lang', lang);
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  location.href = url.toString();
}
