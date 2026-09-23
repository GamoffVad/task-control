// Хранилище данных сервера. В продакшене — PostgreSQL (pgRepo.ts), при разработке — память с записью в файл.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Data } from '../src/lib/types';

export interface Repo {
  /** Название хранилища для /api/health. */
  readonly kind: string;
  /** Текущие данные; null — база ещё пустая. */
  read(): Promise<Data | null>;
  /**
   * Изменение под блокировкой: читает данные, вызывает fn и сохраняет только изменившиеся записи.
   * Если fn бросает исключение, ничего не сохраняется.
   */
  update(fn: (current: Data | null) => Data): Promise<Data>;
  /** Закрыть соединения (тесты). */
  close?(): Promise<void>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Хранилище в памяти; с file — переживает перезапуск сервера разработки. */
export const createMemoryRepo = (file?: string, initial: Data | null = null): Repo => {
  let data: Data | null = initial;
  if (file && existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      data = null;
    }
  }
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: file ? 'file' : 'memory',
    async read() {
      return data ? clone(data) : null;
    },
    update(fn) {
      const run = chain.then(() => {
        const next = fn(data ? clone(data) : null);
        data = clone(next);
        if (file) {
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, JSON.stringify(data));
        }
        return clone(next);
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
};
