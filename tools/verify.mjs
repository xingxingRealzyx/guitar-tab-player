/**
 * TabDeck 冒烟测试：起一个内置静态服务，用真实浏览器（Chromium）验证
 *   - 页面无控制台报错、无请求失败
 *   - 载入真实 .gp 文件后能解析、能渲染成 SVG、播放器就绪
 *   - 深色配色真的生效（不是默认的“白纸黑墨”）
 *   - 播放推进、变速真的改变播放速率、AB 循环真的生效
 *   - 六线谱/五线谱切换、混音台、偏好持久化
 * 用法：npm run verify   （首次需 npx playwright install chromium）
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8788;
const SHOTS = path.join(ROOT, 'screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.sf2': 'application/octet-stream',
  '.sf3': 'application/octet-stream',
  '.gp': 'application/octet-stream',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const abs = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(abs);
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

await mkdir(SHOTS, { recursive: true });
const fixture = path.join(ROOT, 'fixtures', 'demo.gp');
if (!existsSync(fixture)) {
  console.error('缺少 fixtures/demo.gp，先运行：npm run fixtures');
  process.exit(2);
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
check('首页可加载', (await page.title()).includes('TabDeck'));
check('原生 file input 已隐藏', await page.evaluate(() => {
  const i = document.querySelector('input[type=file]');
  return i && getComputedStyle(i).display === 'none';
}));
await page.screenshot({ path: path.join(SHOTS, '1-empty.png') });

// ---- 载入真实 .gp ----
await page.setInputFiles('input[type=file]', fixture);
await page.waitForSelector('#stage:not(.hidden)', { timeout: 15000 });
await page.waitForTimeout(2500);

const loaded = await page.evaluate(() => {
  const a = window.__tabdeck.api;
  const fills = {};
  for (const e of document.querySelectorAll('#alphaTab svg *')) {
    const f = getComputedStyle(e).fill;
    if (f && f !== 'none') fills[f] = (fills[f] || 0) + 1;
  }
  return {
    title: a.score?.title, tracks: a.tracks.length, endTick: a.endTick, endTime: a.endTime,
    ready: a.isReadyForPlayback, svg: !!document.querySelector('#alphaTab svg'),
    staffLines: fills['rgb(58, 66, 78)'] || 0,
    glyphs: fills['rgb(231, 234, 238)'] || 0,
    scoreTitleText: document.getElementById('songTitle').textContent,
  };
});
check('.gp 文件解析成功', loaded.title === 'TabDeck Demo', loaded.title);
check('渲染出 SVG 谱面', loaded.svg);
check('总时长正确（16 小节 @100bpm = 38.4s）', Math.abs(loaded.endTime - 38400) < 50, `${loaded.endTime}ms`);
check('播放器就绪（音色库已加载）', loaded.ready);
check('标题栏显示曲名', loaded.scoreTitleText === 'TabDeck Demo');
check('深色配色生效（谱线 + 音符）', loaded.staffLines > 5 && loaded.glyphs > 5,
  `谱线元素 ${loaded.staffLines} / 音符元素 ${loaded.glyphs}`);
await page.screenshot({ path: path.join(SHOTS, '2-loaded.png') });

// ---- 播放推进 + 变速 ----
// 注意：alphaTab 的 timePosition 是「输出时间」，变速时整条时间轴会被拉伸
// （0.5× 时 38.4s 的曲子总时长显示 76.8s），所以 position 与墙钟仍是 1:1。
// 要验证速率，必须量「乐谱 tick」的推进速度——tick 与速度无关。
const seekStart = () => page.evaluate(() => { const a = window.__tabdeck.api; a.tickPosition = 0; });
const tickAdvance = async (ms) => {
  const t0 = await page.evaluate(() => window.__tabdeck.api.tickPosition);
  await page.waitForTimeout(ms);
  const t1 = await page.evaluate(() => window.__tabdeck.api.tickPosition);
  return t1 - t0;
};
const setSpeedUI = (v) => page.evaluate((val) => {
  const s = document.getElementById('spd');
  s.value = String(val);
  s.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

await page.evaluate(() => { const a = window.__tabdeck.api; a.isLooping = false; a.playbackRange = null; });
await setSpeedUI(1);
await seekStart();
await page.click('#btnPlay');
await page.waitForTimeout(400);
const t100 = await tickAdvance(2000);
const endTime100 = await page.evaluate(() => window.__tabdeck.api.endTime);
await page.evaluate(() => window.__tabdeck.api.pause());
check('100% 速度下正常播放', t100 > 1500, `2s 内 ${t100} ticks`);
check('100% 时总时长 = 38.4s', Math.abs(endTime100 - 38400) < 100, `${endTime100}ms`);

await setSpeedUI(0.5);
await seekStart();
await page.click('#btnPlay');
await page.waitForTimeout(400);
const t50 = await tickAdvance(2000);
const endTime50 = await page.evaluate(() => window.__tabdeck.api.endTime);
await page.evaluate(() => window.__tabdeck.api.pause());
const ratio = t100 / t50;
check('50% 速度下播放速率减半', ratio > 1.7 && ratio < 2.3, `tick 速率比 ${ratio.toFixed(2)}（${t100} vs ${t50}）`);
check('时间轴随速度拉伸（总时长 76.8s）', Math.abs(endTime50 - 76800) < 200, `${endTime50}ms`);
await page.screenshot({ path: path.join(SHOTS, '3-playing.png') });

// ---- 滑窗滚动（Songsterr 手感：谱面滑过去、指针基本停在原地）----
await setSpeedUI(1);
const wide = await page.evaluate(() => {
  const v = document.getElementById('viewport');
  return { scrollW: v.scrollWidth, clientW: v.clientWidth, mode: window.__tabdeck.api.settings.player.scrollMode };
});
check('谱面宽于一屏（有可滑动空间）', wide.scrollW - wide.clientW > 200,
  `${wide.scrollW}px 内容 / ${wide.clientW}px 视口`);
check('滚动模式 = Smooth', wide.mode === 3 || wide.mode === 'Smooth', String(wide.mode));

await seekStart();
await page.waitForTimeout(400);
const sl0 = await page.evaluate(() => document.getElementById('viewport').scrollLeft);
await page.click('#btnPlay');
await page.waitForTimeout(4000);
const sl1 = await page.evaluate(() => document.getElementById('viewport').scrollLeft);
// 用 3px 宽的 beat 指针（真正的播放位置），不是整小节高亮块
const curAt = await page.evaluate(() => {
  const v = document.getElementById('viewport').getBoundingClientRect();
  const c = document.querySelector('#alphaTab .at-cursor-beat');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { cursorX: Math.round(r.left - v.left), viewportW: Math.round(v.width) };
});
const curStyle = await page.evaluate(() => {
  const bg = (sel) => {
    const e = document.querySelector(sel);
    return e ? getComputedStyle(e).backgroundColor : null;
  };
  return { beatBg: bg('#alphaTab .at-cursor-beat'), barBg: bg('#alphaTab .at-cursor-bar'),
           highlights: document.querySelectorAll('#alphaTab .at-highlight').length };
});
await page.screenshot({ path: path.join(SHOTS, '3b-scroll.png') });
await page.evaluate(() => window.__tabdeck.api.pause());
check('播放时谱面连续滑动（滑窗）', sl1 > sl0 + 25, `scrollLeft ${Math.round(sl0)} → ${Math.round(sl1)}`);
check('指针可见（不是透明的空 div）', (() => {
  const c = curStyle.beatBg || '';
  return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
})(), `beat 背景 ${curStyle.beatBg} / 小节高亮 ${curStyle.barBg}`);
check('指针停在视口内且偏左约 1/3（当前小节不会被切掉）',
  !!curAt && curAt.cursorX > curAt.viewportW * 0.15 && curAt.cursorX < curAt.viewportW * 0.5,
  curAt ? `指针 x=${curAt.cursorX} / 视口宽 ${curAt.viewportW}（${(curAt.cursorX / curAt.viewportW * 100).toFixed(0)}%）` : '未取到指针元素');

// 跳转后视口要跟着走，否则指针会飞出屏幕
await page.click('#btnHome');
await page.waitForTimeout(700);
const home = await page.evaluate(() => {
  const v = document.getElementById('viewport').getBoundingClientRect();
  const c = document.querySelector('#alphaTab .at-cursor-beat');
  return { tick: Math.round(window.__tabdeck.api.tickPosition), playing: window.__tabdeck.api.playerState === 1,
           cursorX: c ? Math.round(c.getBoundingClientRect().left - v.left) : null, viewportW: Math.round(v.width) };
});
check('“回到开头”真的归零', home.tick < 100 && !home.playing, `tick=${home.tick}, 播放中=${home.playing}`);
check('归零后指针回到视口内', home.cursorX === null || home.cursorX < home.viewportW * 0.5,
  home.cursorX === null ? '未取到指针' : `指针 x=${home.cursorX}`);

// ---- AB 循环 ----
await setSpeedUI(1);
await page.evaluate(() => { const a = window.__tabdeck.api; a.tickPosition = 0; a.isLooping = false; a.playbackRange = null; });
await page.click('#btnPlay');
await page.waitForTimeout(800);
await page.click('#btnA');
await page.waitForTimeout(1500);
await page.click('#btnB');
await page.click('#btnLoop');
await page.waitForTimeout(300);
const loop = await page.evaluate(() => ({
  zone: !document.getElementById('loopZone').classList.contains('hidden'),
  range: !!window.__tabdeck.api.playbackRange,
  looping: window.__tabdeck.api.isLooping,
}));
check('AB 循环区间已设置', loop.range && loop.looping);
check('进度条上显示循环区间', loop.zone);
// 循环是否真的回卷
const before = await page.evaluate(() => window.__tabdeck.api.tickPosition);
await page.waitForTimeout(2600);
const after = await page.evaluate(() => window.__tabdeck.api.tickPosition);
const range = await page.evaluate(() => window.__tabdeck.api.playbackRange);
check('播放被限制在 A/B 区间内', after >= range.startTick - 100 && after <= range.endTick + 100,
  `tick ${after} ∈ [${range.startTick}, ${range.endTick}]（2.6s 前为 ${before}）`);
await page.screenshot({ path: path.join(SHOTS, '4-loop.png') });
await page.keyboard.press('Space');

// ---- 五线谱切换 / 混音台 / 静音 ----
await page.click('#btnStave');
await page.waitForTimeout(1200);
check('切换到五线谱+六线谱', (await page.evaluate(() => window.__tabdeck.api.settings.display.staveProfile)) === 1);
await page.screenshot({ path: path.join(SHOTS, '5-staff.png') });
await page.click('#btnStave');

await page.click('#btnMixer');
await page.waitForTimeout(400);
check('混音台列出音轨', (await page.evaluate(() => document.querySelectorAll('#mixerList .mtrack').length)) >= 1);
await page.click('#mixerList .mm.m');
await page.waitForTimeout(200);
check('静音按钮生效', await page.evaluate(() => document.querySelector('#mixerList .mm.m').classList.contains('on')));
await page.screenshot({ path: path.join(SHOTS, '6-mixer.png') });
await page.click('#btnMixerClose');

// ---- 偏好持久化（走 UI 路径，prefs 才会落盘） ----
await setSpeedUI(0.6);
if (!(await page.evaluate(() => window.__tabdeck.api.isLooping))) await page.click('#btnLoop');
await page.waitForTimeout(300);
await page.reload({ waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', fixture);
await page.waitForTimeout(2500);
const prefs = await page.evaluate(() => ({ speed: window.__tabdeck.api.playbackSpeed, looping: window.__tabdeck.api.isLooping, endTime: window.__tabdeck.api.endTime }));
check('刷新后速度偏好保留', Math.abs(prefs.speed - 0.6) < 0.001, String(prefs.speed));
check('刷新后循环偏好保留', prefs.looping === true);
check('刷新后按保留速度重建时间轴', Math.abs(prefs.endTime - 38400 / 0.6) < 200, `${Math.round(prefs.endTime)}ms`);
await page.screenshot({ path: path.join(SHOTS, '7-restored.png') });

// ---- 曲库 ----
await page.click('#btnLibrary');
await page.waitForSelector('#libList .librow', { timeout: 15000 });
await page.waitForTimeout(500);
const lib = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#libList .librow')];
  return {
    cats: [...document.querySelectorAll('#libCats .chip')].map((c) => c.textContent.trim()),
    rows: rows.length,
    first: rows[0]?.querySelector('.t b')?.textContent,
    notice: (document.getElementById('libNote').textContent || '').includes('公有领域'),
  };
});
check('曲库面板列出全部曲目', lib.rows >= 20, `${lib.rows} 首 / ${lib.cats.length} 个分类：${lib.cats.slice(0, 3).join('，')}…`);
check('曲库标注了版权来源', lib.notice);
await page.screenshot({ path: path.join(SHOTS, '8-library.png') });

await page.fill('#libSearch', '五声');
await page.waitForTimeout(400);
const searched = await page.evaluate(() => [...document.querySelectorAll('#libList .librow .t b')].map((x) => x.textContent));
check('曲库搜索生效', searched.length > 0 && searched.length < lib.rows, `「五声」→ ${searched.length} 首`);
await page.fill('#libSearch', '');
await page.waitForTimeout(300);

// 从曲库载入一首中国风曲目
const target = await page.evaluate(() => {
  const chip = [...document.querySelectorAll('#libCats .chip')].find((c) => c.textContent.includes('中国风 · 公有领域'));
  chip?.click();
  return true;
});
await page.waitForTimeout(400);
const firstCn = await page.evaluate(() => document.querySelector('#libList .librow .t b').textContent);
await page.click('#libList .librow');
await page.waitForTimeout(3500);
const fromLib = await page.evaluate(() => {
  const a = window.__tabdeck.api;
  return { title: a.score?.title, bars: a.score?.masterBars.length, ready: a.isReadyForPlayback,
           svg: !!document.querySelector('#alphaTab svg'), status: document.getElementById('status').textContent };
});
check('从曲库载入曲目并渲染', fromLib.svg && fromLib.ready && fromLib.bars > 8,
  `《${fromLib.title}》${fromLib.bars} 小节，状态栏「${fromLib.status}」`);
check('曲库载入的是所选曲目', fromLib.title === firstCn, `${firstCn} → ${fromLib.title}`);

// 多轨电吉他编曲：主音 + 节奏 + 贝斯，且能分轨静音
const multi = await page.evaluate(() => {
  const a = window.__tabdeck.api;
  return { tracks: a.tracks.map((t) => t.name), pills: [...document.querySelectorAll('#pills .pill')].map((p) => p.textContent) };
});
check('中国风曲目是多轨编曲（主音/节奏/贝斯）',
  multi.tracks.length >= 3 && multi.tracks.some((t) => t.includes('节奏')) && multi.tracks.some((t) => t.includes('贝斯')),
  multi.tracks.join(' / '));
check('音轨切换胶囊每轨一个', multi.pills.length === multi.tracks.length + 1, multi.pills.join(' · '));

// 单独看节奏轨 + 静音它，验证分轨真的生效
await page.evaluate(() => {
  const pill = [...document.querySelectorAll('#pills .pill')].find((p) => p.textContent.includes('节奏'));
  pill?.click();
});
await page.waitForTimeout(1200);
await page.click('#btnMixer');
await page.waitForTimeout(400);
const muted = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('#mixerList .mtrack')];
  const rhythm = rows.find((r) => r.textContent.includes('节奏'));
  const btn = rhythm?.querySelector('.mm.m');
  btn?.click();
  return { rows: rows.length, clicked: !!btn, on: btn?.classList.contains('on') };
});
check('混音台能对节奏吉他单独静音', muted.clicked && muted.on, `${muted.rows} 条音轨，节奏轨静音=${muted.on}`);
await page.screenshot({ path: path.join(SHOTS, '10-multitrack.png') });
await page.click('#btnMixerClose');
await page.screenshot({ path: path.join(SHOTS, '9-score-from-library.png') });
void target;

// ---- 多轨 .gp 文件（真实 Guitar Pro）不能只剩第一轨 ----
await page.setInputFiles('input[type=file]', path.join(ROOT, 'fixtures', 'multitrack.gp'));
await page.waitForTimeout(4000);
const mt = await page.evaluate(() => {
  const a = window.__tabdeck.api;
  return {
    tracks: (a.tracks || []).map((t) => t.name),
    scoreTracks: a.score ? a.score.tracks.length : 0,
    pills: [...document.querySelectorAll('#pills .pill')].map((p) => p.textContent),
  };
});
check('多轨 .gp 的全部音轨都被载入（不是只剩第一轨）',
  mt.tracks.length >= 3 && mt.tracks.length === mt.scoreTracks,
  `${mt.tracks.length}/${mt.scoreTracks} 轨：[${mt.tracks.join(' / ')}]`);
check('多轨文件的音轨胶囊完整', mt.pills.length === mt.tracks.length + 1, mt.pills.join(' · '));
await page.screenshot({ path: path.join(SHOTS, '11-multitrack-gp.png') });

check('无控制台报错 / 无失败请求', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log('');
for (const r of results) console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} 通过，截图在 screenshots/`);
process.exit(failed.length ? 1 : 0);
