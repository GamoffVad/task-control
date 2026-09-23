declare const __APP_VERSION__: string;

/** Версия приложения (package.json, семантическое версионирование). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
