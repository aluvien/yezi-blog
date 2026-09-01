import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";
import { normalizeMusicDisplayText } from "../src/lib/music.ts";

test("reproducible APlayer patch replaces the current-track HTML sinks", () => {
  const bundle = fs.readFileSync(path.resolve("node_modules/aplayer/dist/APlayer.min.js"), "utf8");
  assert.match(bundle, /template\.title\.textContent=t\.name/);
  assert.match(bundle, /template\.author\.textContent=t\.artist/);
  assert.doesNotMatch(bundle, /template\.title\.innerHTML=t\.name/);
  assert.doesNotMatch(bundle, /template\.author\.innerHTML=t\.artist/);
});

test("APlayer controls playback from the real media state and swaps icons synchronously", () => {
  const bundle = fs.readFileSync(path.resolve("node_modules/aplayer/dist/APlayer.min.js"), "utf8");
  assert.match(bundle, /skipPlayButton\.addEventListener\("click",function\(\)\{e\.player\.audio\.paused\?e\.player\.play\(\):e\.player\.pause\(\)\}\)/);
  assert.doesNotMatch(bundle, /skipPlayButton\.addEventListener\("click",function\(\)\{e\.player\.toggle\(\)\}\)/);
  assert.match(bundle, /template\.button\.innerHTML=o\.default\.pause,this\.template\.skipPlayButton\.innerHTML=o\.default\.pause/);
  assert.match(bundle, /template\.button\.innerHTML=o\.default\.play,this\.template\.skipPlayButton\.innerHTML=o\.default\.play/);
  assert.doesNotMatch(bundle, /template\.button\.innerHTML="",setTimeout\(function\(\)\{e\.template\.button\.innerHTML=o\.default\.(?:play|pause)\},100\)/);
});

test("hostile upstream labels remain text at the final player DOM boundary", () => {
  const { document } = parseHTML("<div><span id=title></span><span id=artist></span></div>");
  const title = document.getElementById("title");
  const artist = document.getElementById("artist");
  title.textContent = normalizeMusicDisplayText('<img src=x onerror=alert(1)> &lt;style&gt;', "QQ 音乐");
  artist.textContent = normalizeMusicDisplayText("<style>body{display:none}</style>");
  assert.equal(title.querySelector("img"), null);
  assert.equal(artist.querySelector("style"), null);
  assert.equal(title.childElementCount, 0);
  assert.equal(artist.childElementCount, 0);
});
