import { applyTheme, useTheme } from '../lib/theme';
import { useStore } from '../lib/store';
import { Icon } from './Icons';

/** Переключатель светлой и тёмной темы. Выбор хранится в браузере и запоминается за сотрудником. */
export const ThemeToggle = () => {
  const { state } = useStore();
  const theme = useTheme();
  const next = theme === 'dark' ? 'светлую' : 'тёмную';
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark', state.user?.employeeId)}
      aria-label={`Включить ${next} тему`}
      data-tip={`Включить ${next} тему`}
    >
      {theme === 'dark' ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
    </button>
  );
};
