import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const fonts = path.join(root, "public/fonts");
const manifest = JSON.parse(fs.readFileSync(path.join(fonts, "subsets/manifest.json"), "utf8"));
const css = fs.readFileSync(path.join(root, "src/app/whono/styles/fonts.generated.css"), "utf8");

function codepoints(value) {
  const points = new Set();
  for (const range of value.split(",")) {
    const [start, end = start] = range.trim().replace(/^U\+/i, "").split("-");
    for (let point = parseInt(start, 16); point <= parseInt(end, 16); point++) points.add(point);
  }
  return points;
}

test("font subsets retain the complete original CJK coverage without overlaps", () => {
  for (const source of manifest.sources) {
    const data = fs.readFileSync(path.join(fonts, source.file));
    assert.equal(createHash("sha256").update(data).digest("hex"), source.sha256);
    const coverage = new Set();
    for (const file of manifest.files.filter((file) => file.source === source.file)) {
      const points = codepoints(file.unicodeRange);
      assert.equal(points.size, file.characters);
      assert.ok(points.size <= (source.file.includes("-common.") ? 256 : 192));
      for (const point of points) {
        assert.ok(!coverage.has(point), `${source.file}: overlapping U+${point.toString(16)}`);
        coverage.add(point);
      }
    }
    assert.equal(coverage.size, source.characters);
    assert.deepEqual(coverage, codepoints(source.unicodeRange));
  }
});

test("all font rules have valid, small, content-versioned WOFF2 files", () => {
  const faces = [...css.matchAll(/@font-face\{([^}]+)\}/g)].map((match) => match[1]);
  assert.equal(faces.length, manifest.files.length);
  for (const file of manifest.files) {
    const data = fs.readFileSync(path.join(fonts, "subsets", file.file));
    assert.equal(data.toString("ascii", 0, 4), "wOF2");
    assert.equal(data.length, file.bytes);
    assert.ok(data.length <= 96 * 1024, `${file.file} is too large`);
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
    assert.ok(file.file.endsWith(`-${hash}.woff2`));
    const matching = faces.filter((face) => face.includes(`/fonts/subsets/${file.file}`));
    assert.equal(matching.length, 1);
    const source = manifest.sources.find((source) => source.file === file.source);
    assert.ok(matching[0].includes(`font-family:"${source.family}";`));
    assert.ok(matching[0].includes(`font-weight:${source.weight};`));
    assert.ok(matching[0].includes("font-display:swap;"));
    assert.ok(matching[0].includes(`unicode-range:${file.unicodeRange};`));
  }
});

test("a Chinese first screen downloads a fraction of the full common fonts", () => {
  const text = codepoints("U+0000-007F");
  for (const character of "首页随笔絮语小记归档关于搜索夜间模式互联网这么大总该留一小块地方给自己记录代码产品商业生活也记录那些突然出现未必成熟却值得被留下来的想法这里只留下一些属于自己的痕迹索引发布于认真写字也认真生活") {
    text.add(character.codePointAt(0));
  }
  const commonFiles = manifest.files.filter((file) => file.source.includes("-cjk-common."));
  const selected = commonFiles.filter((file) => [...codepoints(file.unicodeRange)].some((point) => text.has(point)));
  const selectedBytes = selected.reduce((total, file) => total + file.bytes, 0);
  const originalBytes = manifest.sources.filter((source) => source.file.includes("-cjk-common."))
    .reduce((total, source) => total + fs.statSync(path.join(fonts, source.file)).size, 0);
  assert.ok(selectedBytes < originalBytes * 0.4, `${selectedBytes} / ${originalBytes} bytes`);
  const globalCSS = fs.readFileSync(path.join(root, "src/app/whono/styles/global.css"), "utf8");
  assert.ok(globalCSS.includes('@import "./fonts.generated.css";'));
  assert.ok(!/src:.*cjk-(common|ext)\.woff2/.test(globalCSS));
});
