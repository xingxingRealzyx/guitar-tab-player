/**
 * 曲库校验器：把 scores/index.json 里列出的每个 .alphatex 都真正解析一遍，
 * 检查能否被引擎读入、小节是否写满（拍数对不对）、音符数是否正常。
 *
 *   node tools/check-scores.mjs                  # 校验全部
 *   node tools/check-scores.mjs molihua blues-e  # 只校验指定 id
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const alphaTab = require('@coderline/alphatab');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv.slice(2);

// alphaTab 的 Duration 枚举值就是分母（Quarter=4, Eighth=8…），负值/特殊值单独处理
const DURATION_FRACTION = {
  1: 1, 2: 1 / 2, 4: 1 / 4, 8: 1 / 8, 16: 1 / 16, 32: 1 / 32, 64: 1 / 64,
  [-2]: 2, [-4]: 4, // DoubleWhole / QuadrupleWhole
};

function beatFraction(beat) {
  const base = DURATION_FRACTION[beat.duration];
  if (!base) return null;
  const dots = beat.dots || 0;
  const dotFactor = 2 - Math.pow(2, -dots);            // 附点：1.5 / 1.75 …
  const tn = beat.tupletNumerator || 1;
  const td = beat.tupletDenominator || 1;
  return base * dotFactor * (td / tn);                 // 三连音 = 2/3
}

const manifest = JSON.parse(await readFile(path.join(ROOT, 'scores', 'index.json'), 'utf8'));
const entries = manifest.scores.filter((s) => filter.length === 0 || filter.includes(s.id));

if (entries.length === 0) {
  console.error('没有匹配的曲目（检查 id）');
  process.exit(2);
}

let failed = 0;
const rows = [];
for (const entry of entries) {
  const abs = path.join(ROOT, entry.file);
  let tex;
  try {
    tex = await readFile(abs, 'utf8');
  } catch {
    console.log(`  ✗ ${entry.id.padEnd(22)} 文件不存在：${entry.file}`);
    failed++;
    continue;
  }
  try {
    const settings = new alphaTab.Settings();
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(tex, settings);
    const score = importer.readScore();

    let notes = 0;
    const badBars = [];
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        staff.bars.forEach((bar, i) => {
          const masterBar = score.masterBars[i];
          const expected = masterBar.timeSignatureNumerator / masterBar.timeSignatureDenominator;
          let actual = 0;
          for (const voice of bar.voices) {
            for (const beat of voice.beats) {
              notes += beat.notes.length;
              const f = beatFraction(beat);
              actual += f === null ? 0 : f;
            }
          }
          if (Math.abs(actual - expected) > 0.001) {
            badBars.push(`第 ${i + 1} 小节 实际 ${actual.toFixed(3)} / 应为 ${expected.toFixed(3)}`);
          }
        });
      }
    }

    const titleOk = score.title && !/^t$/.test(score.title);
    const problems = [];
    if (!titleOk) problems.push('缺 \\title');
    if (!score.tempo) problems.push('缺 \\tempo');
    if (score.masterBars.length < 4) problems.push(`只有 ${score.masterBars.length} 小节（至少 8 小节更像正经练习）`);
    if (notes < 16) problems.push(`音符太少（${notes}）`);
    if (badBars.length) problems.push(...badBars.slice(0, 4));

    if (problems.length) {
      console.log(`  ✗ ${entry.id.padEnd(22)} ${problems.join('；')}`);
      failed++;
    } else {
      const names = score.tracks.map((t) => t.name || '未命名');
      rows.push({ id: entry.id, bars: score.masterBars.length, notes, tempo: score.tempo, tracks: score.tracks.length });
      console.log(`  ✓ ${entry.id.padEnd(22)} ${String(score.masterBars.length).padStart(3)} 小节 · ${String(notes).padStart(4)} 音 · tempo ${String(score.tempo).padStart(3)} · ${score.tracks.length} 轨 [${names.join('/')}]`);
    }
  } catch (e) {
    const inner = e.inner || e.innerError;
    const detail = inner ? `（${String(inner.message || inner).slice(0, 120)}）` : "";
    console.log(`  ✗ ${entry.id.padEnd(22)} 解析失败：${e.message}${detail}`);
    failed++;
  }
}

console.log('');
if (failed) {
  console.log(`${entries.length - failed}/${entries.length} 通过，${failed} 个有问题`);
  process.exit(1);
}
const totalNotes = rows.reduce((n, r) => n + r.notes, 0);
const totalBars = rows.reduce((n, r) => n + r.bars, 0);
const multi = rows.filter((r) => r.tracks > 1).length;
console.log(`${entries.length}/${entries.length} 通过 · 合计 ${totalBars} 小节 / ${totalNotes} 个音 · 其中 ${multi} 首是多轨编曲`);
