import { expect, test, type Locator, type Page } from "@playwright/test";

function silentWav() {
  const length = 8_000 * 30 * 2;
  const buffer = Buffer.alloc(44 + length);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + length, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(length, 40);
  return buffer;
}

const songs = [1, 2, 3].map(index => ({
  name: `测试歌曲 ${index}`, artist: "测试歌手", key: `qqvip:fixture-song-${index}`,
  cover: "https://music-fixture.invalid/cover.png", url: `/test-audio/${index}.wav`, lrc: `/test-lyrics/${index}.lrc`,
}));

type TestWindow = Window & { testAudio?: HTMLMediaElement };
function audioState(page: Page) {
  return page.evaluate(() => {
    const audio = (window as TestWindow).testAudio;
    return audio ? { source: new URL(audio.src).pathname, paused: audio.paused } : null;
  });
}

async function swipe(page: Page, card: Locator) {
  const stage = card.locator(".music-trigger-swipe-stage");
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(stage).not.toHaveClass(/is-dragging/);
}

async function selected(card: Locator, index: number) {
  await expect(card.locator('[data-track-slot="current"] .music-trigger-name')).toHaveText(`测试歌曲 ${index} 等 3 首`);
}

async function lyrics(card: Locator, index: number) {
  await expect(card).toHaveClass(/is-playing/);
  await expect(card.locator('[data-track-slot="current"] .music-trigger-lyric-text')).toHaveText(`歌曲 ${index} 的歌词`);
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // APlayer owns a detached Audio element, so observe its real play calls.
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as TestWindow).testAudio = this;
      return play.call(this);
    };
  });
  const login = await request.post("/api/admin/login", { data: { password: "e2e-test-password" } });
  expect(login.ok()).toBe(true);
  const slug = `playlist-interaction-${testInfo.testId}-${Date.now()}`;
  const post = await request.post("/api/admin/v1/posts", { data: {
    title: "歌单交互回归", slug, content: "!music qqvip:fixture-list:playlist\n\n!music qqvip:other-song:song",
    cover: null, category: "", tags: "", attachmentIds: [], status: "published",
  } });
  expect(post.ok()).toBe(true);
  await page.route("https://music-fixture.invalid/cover.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64") }));
  await page.route("**/test-audio/*.wav", route => route.fulfill({ contentType: "audio/wav", body: silentWav() }));
  await page.route("**/test-lyrics/*.lrc", route => {
    const index = route.request().url().match(/(\d+)\.lrc/)![1];
    return route.fulfill({ contentType: "text/plain", body: `[00:00.00]歌曲 ${index} 的歌词\n[00:20.00]歌曲 ${index} 的下一句` });
  });
  await page.route("**/api/music/qq?*", route => {
    const url = new URL(route.request().url());
    const metadata = url.searchParams.get("type")!.includes("metadata");
    if (url.searchParams.get("id") === "other-song") {
      return route.fulfill({ json: { ...songs[0], key: "qqvip:other-song", name: "另一张卡片的歌曲", url: metadata ? "" : songs[0].url } });
    }
    return route.fulfill({ json: { total: 3, tracks: songs.map(song => ({ ...song, url: metadata ? "" : song.url })) } });
  });
  await page.goto(`/posts/${slug}?reading=1`);
  await selected(page.locator('.blog-music[data-id="fixture-list"] .music-trigger'), 1);
});

test("idle playlist swipes only select; explicit play uses the selected audio and lyrics", async ({ page }) => {
  const card = page.locator('.blog-music[data-id="fixture-list"] .music-trigger');
  const playbackRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).searchParams.get("type") === "playlist") playbackRequests.push(request.url()); });
  await swipe(page, card);
  await selected(card, 2);
  await expect(card).not.toHaveClass(/is-playing|has-lyric/);
  expect(playbackRequests).toHaveLength(0);
  expect(await audioState(page)).toBeNull();
  await card.locator(".music-trigger-play").click();
  await lyrics(card, 2);
  await expect.poll(() => audioState(page)).toEqual({ source: "/test-audio/2.wav", paused: false });
  expect(playbackRequests).toHaveLength(1);
});

test("playing swipes switch correctly; paused swipes stay paused and cover rotation keeps its angle", async ({ page }) => {
  const card = page.locator('.blog-music[data-id="fixture-list"] .music-trigger');
  await card.locator(".music-trigger-play").click();
  await lyrics(card, 1);
  await swipe(page, card);
  await selected(card, 2);
  await lyrics(card, 2);
  await expect.poll(() => audioState(page)).toEqual({ source: "/test-audio/2.wav", paused: false });
  const cover = page.locator(".global-player-float-cover");
  await expect.poll(() => cover.evaluate(node => Number(node.getAnimations()[0]?.currentTime ?? 0))).toBeGreaterThan(250);
  await card.locator(".music-trigger-play").click();
  await expect(card).not.toHaveClass(/is-playing/);
  await expect(cover).toHaveCSS("animation-play-state", "paused");
  const paused = await cover.evaluate(node => ({ transform: getComputedStyle(node).transform, time: Number(node.getAnimations()[0].currentTime) }));
  expect(paused.time).toBeGreaterThan(250);
  await page.waitForTimeout(200); // Observe a real pause interval: the transform must stay frozen.
  expect(await cover.evaluate(node => getComputedStyle(node).transform)).toBe(paused.transform);
  await card.locator(".music-trigger-play").click();
  await expect(cover).toHaveCSS("animation-play-state", "running");
  const resumed = await cover.evaluate(node => Number(node.getAnimations()[0].currentTime));
  expect(resumed).toBeGreaterThanOrEqual(paused.time);
  await expect.poll(() => cover.evaluate(node => getComputedStyle(node).transform)).not.toBe(paused.transform);
  await card.locator(".music-trigger-play").click();
  await expect(card).not.toHaveClass(/is-playing/);
  await swipe(page, card);
  await selected(card, 3);
  await expect(card).not.toHaveClass(/is-playing|has-lyric/);
  expect((await audioState(page))?.paused).toBe(true);
  await card.locator(".music-trigger-play").click();
  await lyrics(card, 3);
});

test("browsing an idle playlist does not interrupt a different card", async ({ page }) => {
  const card = page.locator('.blog-music[data-id="fixture-list"] .music-trigger');
  const other = page.locator('.blog-music[data-id="other-song"] .music-trigger');
  await other.locator(".music-trigger-play").click();
  await expect(other).toHaveClass(/is-playing/);
  const audio = await audioState(page);
  await swipe(page, card);
  await selected(card, 2);
  await expect(card).not.toHaveClass(/is-playing|has-lyric/);
  await expect(other).toHaveClass(/is-playing/);
  expect(await audioState(page)).toEqual(audio);
});

test("a swipe during audio resolution cancels pending autoplay and preserves the latest selection", async ({ page }) => {
  const card = page.locator('.blog-music[data-id="fixture-list"] .music-trigger');
  let release: () => void = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let requested: () => void = () => {};
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/api/music/qq?*", async (route, request) => {
    if (new URL(request.url()).searchParams.get("type") !== "playlist") return route.fallback();
    requested();
    await waiting;
    return route.fulfill({ json: { total: 3, tracks: songs } });
  });
  await card.locator(".music-trigger-play").click();
  await started;
  await swipe(page, card);
  await selected(card, 2);
  release();
  await expect(card).not.toHaveClass(/is-resolving/);
  await selected(card, 2);
  await expect(card).not.toHaveClass(/is-playing|has-lyric/);
  expect(await audioState(page)).toBeNull();
  await card.locator(".music-trigger-play").click();
  await lyrics(card, 2);
});
