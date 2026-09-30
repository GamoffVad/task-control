import { appearanceCss } from '../lib/appearance';
import { useStore } from '../lib/store';

/**
 * Оформление из «Администрирование → Редактирование UI» поверх дизайн-системы.
 * Ставится до цветов справочников, чтобы цвет отдельного вида или категории оставался главнее.
 */
export const AppearanceStyles = () => {
  const { state } = useStore();
  const css = appearanceCss(state.appearance);
  return css ? <style>{css}</style> : null;
};
