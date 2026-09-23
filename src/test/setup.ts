import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  // В серверных тестах (окружение node) хранилища браузера нет.
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
