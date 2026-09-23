import { createContext, useContext } from 'react';
import type { TaskDraft } from '../lib/logic';
import type { Task } from '../lib/types';

export type OpenArgs = { task?: Task; defaults?: Partial<TaskDraft>; context?: string };
type Ctx = { openTask: (args: OpenArgs) => void };
export const EditorContext = createContext<Ctx | null>(null);

export const useTaskEditor = (): Ctx => {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useTaskEditor вызван вне TaskEditorProvider');
  return ctx;
};
