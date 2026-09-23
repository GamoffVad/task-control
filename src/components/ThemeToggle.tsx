import { useEffect, useState } from 'react';
import { applyTheme, readTheme, type Theme } from '../lib/theme';
import { Icon } from './Icons';

/** Переключатель светлой и тёмной темы. Выбор хранится в браузере пользователя. */
export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const next = theme === 'dark' ? 'светлую' : 'тёмную';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      aria-label={`Включить ${next} тему`}
      data-tip={`Включить ${next} тему`}
    >
      {theme === 'dark' ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
    </button>
  );
};
