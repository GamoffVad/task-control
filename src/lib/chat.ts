// Непрочитанные сообщения «Переписки»: чужие сообщения позже отметки «прочитано» сотрудника.

import type { ChatRead, Message } from './types';

/** Момент, до которого сотрудник прочитал переписку; null — ещё не открывал. */
export const chatReadAt = (reads: ChatRead[], employeeId: number | undefined): string | null =>
  reads.find((r) => r.employeeId === employeeId)?.readAt ?? null;

export const unreadMessages = (messages: Message[], reads: ChatRead[], employeeId: number | undefined): Message[] => {
  if (employeeId === undefined) return [];
  const since = chatReadAt(reads, employeeId);
  return messages.filter((m) => m.authorId !== employeeId && (since === null || m.sentAt > since));
};

/** Для счётчика: больше 99 — «99+». */
export const countLabel = (n: number) => (n > 99 ? '99+' : String(n));
