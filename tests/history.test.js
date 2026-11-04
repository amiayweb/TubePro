import { test } from "node:test";
import assert from "node:assert/strict";
import { createResumeWriter, readResume } from "../src/history.js";
const id = "zrpaakpqSK0";
function fixture() {
  const data = {};
  const storage = {
    async get(key) {
      return { [key]: data[key] };
    },
    async set(record) {
      Object.assign(data, record);
    },
  };
  return { storage, save: createResumeWriter(storage) };
}
test("seeking then leaving immediately cannot overwrite the new position with stale page state", async () => {
  const { storage, save } = fixture();
  const now = Date.now();
  await Promise.all([
    save(id, 813, 1050, { sampledAt: now }),
    save(id, 12, 1050, { sampledAt: now - 1000 }),
    save(id, 0, 1050, { sampledAt: now + 1 }),
    save(id, 0, NaN, { sampledAt: now + 2 }),
  ]);
  assert.equal(await readResume(storage, id, 1050), 813);
});
test("completion and intentional rewind to start persist without stale snapshots resurrecting old positions", async () => {
  const { storage, save } = fixture();
  const now = Date.now();
  await save(id, 813, 1050, { sampledAt: now });
  await save(id, 0, 1050, { sampledAt: now + 1, reset: true });
  await save(id, 813, 1050, { sampledAt: now });
  assert.equal(await readResume(storage, id, 1050), 0);
});
