/**
 * 生成验证用的测试谱。
 * 用 alphaTab 的 Gp7Exporter 把一段自写的 alphaTex 导出成真正的 .gp 文件，
 * 这样回归测试走的是「真实 Guitar Pro 文件」的解析路径，而不是内联示例。
 */
const fs = require('fs');
const path = require('path');
const alphaTab = require('@coderline/alphatab');

const TEX = `
\\title "TabDeck Demo"
\\subtitle "E 小调五声 · 自作曲"
\\artist "TabDeck"
\\tempo 100
.
:8 0.6 3.6 5.6 7.5 5.5 7.5 5.6 |
:8 3.6 5.6 7.6 8.5 7.5 5.5 3.5 |
:4 0.6 3.6 5.6 7.6 |
:2 5.6 3.6 |
:8 0.6 3.6 5.6 7.5 5.5 7.5 5.6 |
:8 3.6 5.6 7.6 8.5 7.5 5.5 3.5 |
:4 0.6 3.6 5.6 7.6 |
:2 3.6 0.6 |
:8 12.6 10.6 8.6 7.6 5.6 7.6 5.6 3.6 |
:8 5.5 7.5 5.5 3.5 2.5 3.5 5.5 7.5 |
:4 0.6 3.6 5.6 7.6 |
:2 5.6 7.6 |
:8 0.6 3.6 5.6 7.5 5.5 7.5 5.6 |
:8 3.6 5.6 7.6 8.5 7.5 5.5 3.5 |
:4 0.6 3.6 5.6 7.6 |
:2 0.6 0.6
`;

const settings = new alphaTab.Settings();
const importer = new alphaTab.importer.AlphaTexImporter();
importer.initFromString(TEX, settings);
const score = importer.readScore();

const outDir = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'demo.gp');
const bytes = new alphaTab.exporter.Gp7Exporter().export(score, settings);
fs.writeFileSync(out, bytes);

console.log(`已生成 ${path.relative(process.cwd(), out)}（${bytes.length} 字节，GP7/zip）`);

// 再导一份多轨的（主音 / 节奏 / 贝斯），用来验证“多轨文件不会只剩第一轨”
const multiTex = fs.readFileSync(path.join(__dirname, '..', 'scores', 'molihua.alphatex'), 'utf8');
const multiImporter = new alphaTab.importer.AlphaTexImporter();
const multiSettings = new alphaTab.Settings();
multiImporter.initFromString(multiTex, multiSettings);
const multiScore = multiImporter.readScore();
const multiBytes = new alphaTab.exporter.Gp7Exporter().export(multiScore, multiSettings);
const multiOut = path.join(outDir, 'multitrack.gp');
fs.writeFileSync(multiOut, multiBytes);
console.log(`已生成 ${path.relative(process.cwd(), multiOut)}（${multiBytes.length} 字节，${multiScore.tracks.length} 轨）`);
console.log(`  ${score.title} · ${score.masterBars.length} 小节 · tempo ${score.tempo}`);
