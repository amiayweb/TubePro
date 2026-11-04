import { VIDEO_ID } from "./shared.js";
const prefix = "resume:";
export function resumeKey(id) {
  if (!VIDEO_ID.test(id)) throw new Error("Invalid video ID.");
  return `${prefix}${id}`;
}
export function resumeRecord(position, duration, now = Date.now()) {
  if (
    !Number.isFinite(position) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    position < 5 ||
    duration - position <= 3 ||
    position >= duration * 0.995
  )
    return null;
  return { position, duration, updated: now };
}
export async function readResume(storage, id, duration, now = Date.now()) {
  const key = resumeKey(id);
  const record = (await storage.get(key))[key];
  if (
    !record ||
    !Number.isFinite(record.updated) ||
    now - record.updated > 180 * 86400000 ||
    !resumeRecord(record.position, duration, now)
  )
    return 0;
  if (
    !Number.isFinite(record.duration) ||
    Math.abs(record.duration - duration) > 5
  )
    return 0;
  return record.position;
}
export async function writeResume(
  storage,
  id,
  position,
  duration,
  { sampledAt = Date.now(), ended = false, reset = false } = {},
) {
  const key = resumeKey(id);
  // A detached media element can momentarily report 0 / NaN. Never let that
  // teardown snapshot erase the last real playback position.
  if (
    !Number.isFinite(position) ||
    position < 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(sampledAt)
  )
    return false;
  const completed =
    ended || reset || (duration - position <= 3 && position > 0);
  const record = completed
    ? { position: 0, duration, updated: sampledAt, completed: true }
    : resumeRecord(position, duration, sampledAt);
  if (!record) return false;
  const previous = (await storage.get(key))[key];
  if (previous?.updated > sampledAt) return false;
  await storage.set({ [key]: record });
  return true;
}

/** A single background writer serializes frame and departing-page snapshots. */
export function createResumeWriter(storage) {
  let pending = Promise.resolve();
  return (id, position, duration, options) => {
    const job = pending.then(() =>
      writeResume(storage, id, position, duration, options),
    );
    pending = job.catch(() => {});
    return job;
  };
}
