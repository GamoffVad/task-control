// Раскладка задач дня в сетке календаря.
import type { Task } from './types';

export const FIRST_HOUR = 7;
export const LAST_HOUR = 21;

export type Placed = { task: Task; top: number; height: number; lane: number; lanes: number };

/** Раскладка пересекающихся задач дня по дорожкам. */
export const layoutDay = (tasks: Task[], day: Date): Placed[] => {
  const dayStart = new Date(day);
  dayStart.setHours(FIRST_HOUR, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(LAST_HOUR, 0, 0, 0);
  const items = tasks
    .filter((task) => new Date(task.start).getTime() < dayEnd.getTime() && new Date(task.end).getTime() > dayStart.getTime())
    .map((task) => {
      const s = Math.max(new Date(task.start).getTime(), dayStart.getTime());
      const e = Math.min(new Date(task.end).getTime(), dayEnd.getTime());
      return { task, s, e: Math.max(e, s + 20 * 60_000) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const placed: Placed[] = [];
  let cluster: (typeof items[number] & { lane: number })[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) {
      placed.push({
        task: c.task,
        top: (c.s - dayStart.getTime()) / 3600_000,
        height: (c.e - c.s) / 3600_000,
        lane: c.lane,
        lanes,
      });
    }
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.e);
    let lane = laneEnds.findIndex((end) => end <= it.s);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ ...it, lane });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return placed;
};
