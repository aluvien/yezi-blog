import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIC_NAV_ITEMS,
  PUBLIC_ROUTES,
  getPublicSection,
  isPublicNavActive,
  isPublicPostDetailPath,
} from "../src/lib/site-navigation.ts";

test("builds canonical public content links", () => {
  assert.equal(PUBLIC_ROUTES.post("hello-world"), "/posts/hello-world");
  assert.equal(PUBLIC_ROUTES.post("中文 标题"), "/posts/%E4%B8%AD%E6%96%87%20%E6%A0%87%E9%A2%98");
  assert.equal(PUBLIC_ROUTES.moment(42), "/moments#moment-42");
  assert.equal(PUBLIC_ROUTES.category("产品 设计"), "/categories/%E4%BA%A7%E5%93%81%20%E8%AE%BE%E8%AE%A1");
  assert.equal(PUBLIC_ROUTES.tag("随笔"), "/tags/%E9%9A%8F%E7%AC%94");
});

test("classic labels point to the same canonical pages", () => {
  assert.deepEqual(
    CLASSIC_NAV_ITEMS.map(({ href, label }) => [label, href]),
    [
      ["随笔", "/posts"],
      ["絮语", "/moments"],
      ["小记", "/works"],
      ["归档", "/archives"],
      ["关于", "/about"],
    ],
  );
});

test("groups details and taxonomy pages under articles", () => {
  for (const path of ["/posts/a", "/essay/a", "/archive/a", "/categories/design", "/tags/notes"]) {
    assert.equal(getPublicSection(path), "posts", path);
    assert.equal(isPublicNavActive(path, "posts"), true, path);
  }
  assert.equal(getPublicSection("/archive"), "archives");
  assert.equal(getPublicSection("/archives"), "archives");
});

test("recognizes canonical and legacy article detail paths", () => {
  assert.equal(isPublicPostDetailPath("/posts/a"), true);
  assert.equal(isPublicPostDetailPath("/essay/a"), true);
  assert.equal(isPublicPostDetailPath("/archive/a"), true);
  assert.equal(isPublicPostDetailPath("/posts"), false);
  assert.equal(isPublicPostDetailPath("/archive/rss.xml"), false);
  assert.equal(isPublicPostDetailPath("/categories/design"), false);
});
