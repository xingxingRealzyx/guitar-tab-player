# TabDeck · 本地吉他谱播放器

一个 Songsterr 风格的网页播放器：**把 Guitar Pro / MusicXML 谱拖进去，就能播放、变速、AB 循环、分轨静音地练琴**。纯前端静态页，零后端、零账号、零上传。

自带的能力，恰好是 Songsterr 免费版锁在订阅后面的那部分：变速、循环、单轨静音/独奏、节拍器、预备拍。

**在线版：<https://tab.doublexing.cc>**（部署在 Cloudflare Workers 静态资源上）

![播放中](screenshots/deployed.png)

## 快速开始

```sh
./serve.sh            # 等价于 python3 -m http.server 8777 --bind 127.0.0.1
# 然后打开 http://127.0.0.1:8777/
```

也可以用 `npm run serve`。

> **必须走 http，不能直接双击 `index.html`。** 页面用的是 ES module worker + AudioWorklet，`file://` 下浏览器会拦掉，音色库和渲染都会失败。页面检测到 `file://` 会给出提示。

首次打开想先看效果：点「载入内置示例」（一段自写的 E 小调五声 riff，无版权问题）。

## 部署到 Cloudflare Workers

```sh
wrangler deploy
```

配置在 `wrangler.jsonc`：Worker 名 `tabdeck`，静态资源目录 `.`，自定义域 `tab.doublexing.cc`。

`.assetsignore` 把开发文件挡在上传之外 —— 线上只有 15 个文件（`index.html` + `vendor/`），`node_modules`、`tools/`、`screenshots/`、测试 fixture 都不会被发布，源码文件在线上返回 404。


## 支持的谱面格式

| 格式 | 扩展名 | 说明 |
| --- | --- | --- |
| Guitar Pro 3/4/5 | `.gp3` `.gp4` `.gp5` | 老版本二进制格式 |
| Guitar Pro 6 | `.gpx` | |
| Guitar Pro 7/8 | `.gp` | 现在最通用的格式 |
| MusicXML | `.musicxml` `.xml` `.mxl` | 开放标准，MuseScore / Finale / Sibelius 都能导出 |
| CapXML | `.cap` `.capx` | Capella |
| alphaTex | `.tex` `.alphatex` | alphaTab 自家的文本记谱格式 |

## 功能

- **拖放即用**：整个窗口接受拖放，也可以点「打开文件」
- **播放器**：播放/暂停、回到开头、点进度条任意跳转
- **滑窗滚动（Songsterr 手感）**：横向一行铺开，播放时谱面连续滑过去，绿色播放指针钉在视口左侧约 1/3 处，当前小节整节高亮，正在弹的音符染成绿色
- **变速 25%–150%**：滑杆或 `−`/`+`，不改音高
- **循环**：整曲循环开关；A/B 两点循环（在播放中按 A、B 取当前小节），进度条上会画出区间
- **分轨**：顶部胶囊切换显示哪条音轨；混音台里逐轨静音/独奏/调音量
- **节拍器 + 预备拍**
- **六线谱 / 五线谱** 一键切换
- **偏好本地记忆**：速度、循环、节拍器、音量、谱表显示存在 localStorage，刷新后还在
- **深色主题**：alphaTab 默认是「白纸黑墨」，这里另外配了一套深色渲染色

## 快捷键

| 键 | 作用 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `←` `→` | 后退 / 前进 1 秒 |
| `Home` / `End` | 回到开头 / 跳到结尾 |
| `S` / `Shift+S` | 减速 / 加速 5% |
| `L` | 循环开关 |
| `A` / `B` | 设循环起点 / 终点 |
| `N` / `C` | 节拍器 / 预备拍 |
| `M` | 静音当前音轨 |
| `1`–`9` / `0` | 只显示第 N 轨 / 显示全部 |
| `I` | 混音台 |
| `?` | 快捷键面板 |
| `Esc` | 关闭面板 |

## 实现

```
index.html                 # 全部 UI + 逻辑，单文件
vendor/alphatab/           # 本地化的 alphaTab 运行时（引擎、Bravura 字体、sonivox 音色库）
fixtures/demo.gp           # 测试用谱（脚本生成，16 小节）
tools/make-fixtures.cjs    # 生成 fixtures/demo.gp
tools/verify.mjs           # 浏览器冒烟测试（内置静态服务 + Playwright）
screenshots/               # verify 跑出来的截图
```

引擎是 [alphaTab](https://www.alphatab.net/)：它一家包办了工程里最难的四个模块 —— 格式解析（GP3–GP8 / MusicXML / CapXML / alphaTex）、六线谱排版（Bravura SMuFL 字体）、音频合成（内置 TinySoundFont 的 MIDI 合成器）、以及光标同步交互。所以这个播放器本身只做了三件事：外壳 UI、把练习功能接到 alphaTab 的 API 上、以及深色主题配色。

几个踩过的坑，都写在代码注释里了：

1. **`playerMode` 不能传 `'enabled'`** —— 1.8.x 的 `PlayerMode` 只有 `EnabledAutomatic` / `EnabledSynthesizer` / `EnabledBackingTrack` / `EnabledExternalMedia`，传错字符串不会报错，而是**静默降级成 Disabled**，表现是播放键按了没反应、`endTime` 为 0。代码里直接用了导入的枚举对象。
2. **`soundFontLoaded` / `soundFontLoadFailed` 不在 `AlphaTabApi` 上**，只挂在 `api.player` 上，而 `player` 在构造时还没创建。用 `isReadyForPlayback` 轮询兜底。
3. **`timePosition` 是「输出时间」**：变速时整条时间轴被拉伸（0.5× 时 38.4s 的曲子总时长显示 76.8s），所以它和墙钟始终 1:1。要判断速率得看 tick 推进速度。
4. **深色主题必须自己配 `display.resources` 颜色**，否则五线谱和品位数字是黑墨画在深底上，基本看不见。
5. **播放指针要自己配色**：alphaTab 只给光标元素加 `at-cursor-bar` / `at-cursor-beat` 这些 class，**既不设颜色、官方包里也根本没有 css 文件**。不自己写 CSS 的话指针是个透明的空 div —— 谱面在滑，但你完全看不出播到哪了。
6. **滚动模式决定手感**：`OffScreen`（默认之一）是光标自己在谱面上往右跑、出屏才翻页；`Smooth` 才是谱面按播放速度持续滑过去。另外指针默认被钉在视口最左边、当前小节被切掉一大半，要用 `scrollOffsetX`（实测与指针屏幕位置 1:1）把它推到 1/3 处。
7. **`tickPosition = 0` 之后视口不会自己回去**：alphaTab 只在播放过程中自动滚动，所以任何跳转（回到开头、点进度条、方向键）之后都要补一个 `api.scrollToCursor()`，否则指针直接飞出屏幕。

## 验证

```sh
npm install
npx playwright install chromium   # 首次
npm run fixtures                  # 生成 fixtures/demo.gp
npm run verify                    # 29 项检查 + 截图
```

`npm run verify` 会起一个内置静态服务，用真实 Chromium 加载真实 `.gp` 文件，逐项断言：

- 解析、SVG 渲染、播放器就绪、总时长正确
- 深色配色真的生效（按渲染出的 SVG 元素 fill 颜色统计，不是看配置）
- **变速真的改变播放速率**：量 tick 推进速率，1.0× vs 0.5× 实测比 2.01
- **滑窗真的在滑**：断言 `scrollLeft` 在播放中增长、指针落在视口 15%–50% 之间、指针背景色非透明
- **AB 循环真的回卷**：断言播放位置始终落在 A/B 区间内
- **「回到开头」真的归零**：断言 tick 回 0 且指针回到视口内
- 时间轴随速度拉伸、六线谱切换、混音台静音、刷新后偏好保留
- 全程无控制台报错、无失败请求

当前状态：**29/29 通过**（在从 GitHub 全新克隆出来的副本上同样 29/29）。

## 已知限制

- 只在 Chromium 里验证过；Safari / Firefox 没测（alphaTab 本身支持，但这套 UI 没测过）
- 移动端能打开，但没有针对触摸做手势优化
- 没有谱库、没有搜索、没有用户系统 —— 这是刻意的，见下
- 变速是「时间轴拉伸」语义，所以进度条总时长会随速度变化（0.5× 时 38.4s 显示成 76.8s）。这是 alphaTab 的模型，不是 bug
- 跳转到曲尾时指针会贴在视口左侧（内容已滑到底，没有更多余量），这是滚动容器的物理限制

## 版权

**这个项目不托管、不分发任何乐谱。** 页面只在你自己的浏览器里解析你提供的文件，不上传、不落盘、不索引。

这一点是刻意设计的。网上能免费下到的吉他谱，绝大多数是网友对版权歌曲的记谱，没有授权；把它们收集、托管、公开索引，风险就从原站点转移到你身上 —— Songsterr 自己就是靠买授权活着（它帮助页写着把近一半收入作为版税付出去）。所以：

- **自用**：随便用，把你手上任何 `.gp` 拖进来就行。
- **想公开上线**：只放公有领域的谱（[PDMX](https://github.com/pnlong/PDMX) 有 25 万+ 首公有领域 MusicXML，注意用它的 `no_license_conflict` 子集；OpenScore、Mutopia 同理），或者只做「播放器 + 用户自己导入文件」这种形态，自己不存谱。
- **想放流行歌**：得走授权（国内音著协 MCSC，海外出版商 / Harry Fox / CMRRA），这是另一个量级的成本。

## 依赖许可

| 组件 | 许可 |
| --- | --- |
| 本项目代码 | MIT |
| [alphaTab](https://github.com/CoderLine/alphaTab) | MPL-2.0（文件级 copyleft：不改它自身的文件即可商用闭源；改了那些文件就要公开改动） |
| Bravura 字体 | SIL OFL 1.1 |
| sonivox 音色库 | Apache-2.0（来自 AOSP） |
