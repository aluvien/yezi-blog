import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-life-events-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const {
  db,
  createLifeEvent,
  updateLifeEvent,
  deleteLifeEvent,
  getLifeEvent,
  getLifeEventBySourceMoment,
  listLifeEvents,
  countLifeEvents,
  getLifeEventsByIds,
  lifeEventNodeMapByMoment,
  createMoment,
  deleteMoment,
} = await import("../src/lib/db.ts");

const { parseLifeEventDate, formatLifeEventDate } = await import("../src/lib/life-events.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("date precision normalizes to a sortable stored value and formats back by precision", () => {
  assert.deepEqual(parseLifeEventDate("2002", "year"), { occurredAt: "2002-01-01", precision: "year" });
  assert.deepEqual(parseLifeEventDate("2025-07", "month"), { occurredAt: "2025-07-01", precision: "month" });
  assert.deepEqual(parseLifeEventDate("2026-9-3", "day"), { occurredAt: "2026-09-03", precision: "day" });
  // 精度不匹配（year 却给了月）应被拒绝。
  assert.equal(parseLifeEventDate("2002-07", "year"), null);
  assert.equal(parseLifeEventDate("2026-02-30", "day"), null);
  // 展示按精度还原，绝不把 2002 显示成 2002-01-01。
  assert.equal(formatLifeEventDate("2002-01-01", "year"), "2002");
  assert.equal(formatLifeEventDate("2025-07-01", "month"), "2025-07");
  assert.equal(formatLifeEventDate("2026-09-03", "day"), "2026-09-03");
});

test("creates, updates, paginates and hydrates a manual life event by ids", () => {
  const early = createLifeEvent({ title: "第一个网站", content: "2002", occurred_at: "2002-01-01", date_precision: "year", tags: ["web"] });
  assert.equal(early.source_type, "manual");
  assert.equal(early.source_moment_id, null);
  assert.equal(early.occurred_at, "2002-01-01");

  const updated = updateLifeEvent(early.id, { title: "第一个上线的网站", tags: ["web", "里程碑"] });
  assert.equal(updated.title, "第一个上线的网站");
  assert.equal(updated.tags, '["web","里程碑"]');

  const mid = createLifeEvent({ title: "m2", content: "x", occurred_at: "2015-01-01", date_precision: "year" });
  const list = listLifeEvents({ limit: 1, offset: 0 });
  assert.equal(list.length, 1);
  // occurred_at DESC：较新的 2015 在前。
  assert.equal(list[0].id, mid.id);
  assert.equal(countLifeEvents(), 2);
  const map = getLifeEventsByIds([early.id, mid.id, 999999]);
  assert.equal(map.size, 2);
  assert.equal(map.get(early.id).title, "第一个上线的网站");
});

test("extraction links the source moment, prevents duplicates, and survives source deletion via SET NULL", () => {
  const moment = createMoment({ content: "2002 年第一次做网站", images: [], tags: ["web"], location: "杭州市" });
  const node = createLifeEvent({
    title: "起点",
    content: moment.content,
    occurred_at: "2002-01-01",
    date_precision: "year",
    images: [],
    tags: ["web"],
    location: "杭州市",
    source_type: "moment",
    source_moment_id: moment.id,
  });
  assert.equal(node.source_type, "moment");
  assert.equal(node.source_moment_id, moment.id);
  assert.equal(getLifeEventBySourceMoment(moment.id).id, node.id);
  assert.deepEqual([...lifeEventNodeMapByMoment().keys()], [moment.id]);

  // 同一源絮语不允许重复提取（partial unique index）。
  assert.throws(() => createLifeEvent({ title: "dup", content: "x", occurred_at: "2003-01-01", date_precision: "year", source_type: "moment", source_moment_id: moment.id }), /UNIQUE constraint/i);

  // 删除原絮语：节点保留，仅断开来源关系。
  deleteMoment(moment.id);
  const after = getLifeEvent(node.id);
  assert.ok(after, "生活节点在来源絮语删除后必须保留");
  assert.equal(after.source_moment_id, null);
  assert.equal(getLifeEventBySourceMoment(moment.id), undefined);

  deleteLifeEvent(node.id);
  assert.equal(getLifeEvent(node.id), undefined);
});
