# GitHub Video Studio

GitHub URL 到解说视频的本地流水线：

```text
GitHub API / README
  -> script.json
  -> storyboard.json
  -> IndexTTS-2.5 分句 WAV
  -> Playwright 目标定位与录屏
  -> CameraPose / SVG 标注
  -> Remotion
  -> FFmpeg / MP4 / QA
```

当前交付目标是一个可验证的 12 秒 MVP：1440×1080、30 FPS、H.264、真实 IndexTTS 音频、三段镜头，以及可独立重渲染的 clean/final/covers。

## 快速开始

在 Windows PowerShell 中从项目根目录运行：

```powershell
pnpm install
pnpm video analyze https://github.com/andrewluxem/ultrademo --project demo
pnpm video script demo
pnpm video storyboard demo
pnpm video tts demo
pnpm video capture demo
pnpm video render demo
pnpm video export demo
```

也可以执行完整链路：

```powershell
pnpm video run https://github.com/andrewluxem/ultrademo
```

首次使用前需安装 Playwright Chromium：

```powershell
pnpm exec playwright install chromium
```

## IndexTTS-2.5

默认读取：

```text
根目录：D:\AI\indextts
Python：D:\AI\indextts\.venv\Scripts\python.exe
参考音色：D:\AI\indextts\voice_8yue19.wav
Bridge：http://127.0.0.1:8125
```

CLI 会在 Bridge 不存在时启动 `services/indextts-bridge/server.py`。可以通过环境变量覆盖：

```powershell
$env:INDEXTTS_ROOT = 'D:\AI\indextts'
$env:INDEXTTS_PYTHON = 'D:\AI\indextts\.venv\Scripts\python.exe'
$env:INDEXTTS_VOICE = 'D:\AI\indextts\voice_8yue19.wav'
$env:INDEXTTS_BRIDGE_URL = 'http://127.0.0.1:8125'
$env:INDEXTTS_USE_CUDA_KERNEL = '0'  # 缺少 cl.exe 时保持关闭；默认值就是 0
```

一次只运行一个 IndexTTS 生成进程。每句 WAV 按文本、音色文件大小/修改时间、语言和 Bridge 地址缓存；`timeline-audio.json` 的实测 duration 是字幕和镜头的时间轴。

## 输出

`output/demo/` 会包含：

- `final.mp4`：带真实旁白、字幕、Camera、cursor 和 SVG hand-drawn annotation 的成品。
- `test.mp4`：`final.mp4` 的兼容副本。
- `clean.mp4`：同一 Camera Track、无旁白/字幕/标注的干净画面。
- `capture.mp4`：Playwright WebM capture 的 H.264 转码版本。
- `narration.wav`、`timeline.json`、`subtitle.srt`、`quality.json`。
- `cover-4x3.png`（1200×900）和 `cover-3x4.png`（900×1200），两种布局分别由 Remotion 直接渲染。

中间数据位于 `projects/demo/`，包括 `github.json`、`script.json`、`storyboard.json`、capture manifest、截图和 TTS 分句音频。运行时媒体被 `.gitignore` 排除。

## 镜头与标注

Camera Engine 使用内容空间 `CameraPose { scale, cx, cy }`，支持：

- bbox fitting、padding、边界 clamp、最大 scale 2.8；
- 450–650ms easing zoom/pan；
- 远距离目标的 `zoom out -> base -> zoom in` chain；
- camera group 内 SVG 标注，字幕在 camera group 外。

Annotation Engine 是 Remotion 原生 deterministic SVG，不依赖 Rough Notation runtime。当前支持 `hand-circle`、`hand-underline`、`hand-box`、`arrow`、`spotlight` 和 `text-selection`；`annotation.id` 作为 jitter seed。

首版 storyboard 固定三段：仓库标题、Stars、README 文本。脚本使用 OpenAI-Compatible provider 时只允许依据分析结果生成；没有 provider 配置时使用本地事实驱动脚本。音频超过 12 秒时，CLI 会依据真实 IndexTTS duration 切换到更短脚本，不强行压缩语速。

## 检查

```powershell
pnpm typecheck
pnpm test
```

`quality.json` 检查媒体尺寸、帧率、H.264/AAC、时长、Camera 上限与边界、目标安全区、快速跳跃、标注存在、字幕安全区、黑帧、白帧、冻结和音视频结束偏差。最终仍应人工查看首帧、场景边界帧、中段和尾帧。

## 当前边界

- 只支持公开 GitHub 仓库；`GITHUB_TOKEN` 仅可选用于 API 提额，不实现私有仓库访问。
- Electron 当前是共享 pipeline 的基础 React/Vite 壳；完整 storyboard 可视化编辑器和 45 秒模板在 MVP 验收后接入。
- OpenScreen GUI 没有可验证的 headless CLI，因此不作为运行依赖。
- `THIRD_PARTY_NOTICES.md` 记录 programatic-demo、Ultrademo 和 Rough Notation 的参考范围；Rough Notation 只做视觉参考，不复制运行时代码。
