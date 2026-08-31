# GitHub Video Studio Implementation Plan

## 12 秒 MVP 验收清单

- [x] pnpm Monorepo、TypeScript strict、CLI、Remotion、Playwright、FFmpeg utilities。
- [x] GitHub public repository analyzer：API、raw README、sections、images、warnings。
- [x] OpenAI-Compatible script provider 与本地事实驱动 fallback。
- [x] 三段 storyboard：repo title、Stars、README text。
- [x] IndexTTS loopback HTTP Bridge、分句 WAV、ffprobe duration、文本/音色缓存。
- [x] Playwright 1440×1080 capture：selector、DOM text、bbox、scrollY、截图和 cursor track。
- [x] CameraPose：fitTarget、zoomTo、panTo、zoomOut、远距离 Zoom Chain、easing、scale cap。
- [x] Remotion 原生 deterministic SVG annotations：circle、underline、box、arrow、spotlight、selection。
- [x] 字幕由 audio timeline 生成 SRT；字幕不进入 camera group。
- [x] clean/final 分离；clean 保留 Camera Track 但不带旁白、字幕和标注。
- [x] Remotion 独立直出 4:3 和 3:4 covers。
- [x] capture.mp4、clean.mp4、final.mp4、test.mp4 compatibility copy、timeline.json、subtitle.srt、narration.wav、quality.json。
- [x] 单句 TTS、capture group 和 render stage hash cache。
- [x] 单元测试覆盖 bbox fitting、safe area、zoom chain、seeded annotation、subtitle timing。
- [x] 基础媒体 QA 与黑帧、白帧、冻结、Camera bounds、目标裁切、字幕安全区和 AV end delta 检查。

## 后续阶段

- [ ] 将 Electron 壳接入主进程 IPC 和 CLI job runner。
- [ ] storyboard 时间轴编辑器、目标重新定位、标注参数编辑、局部 still/render。
- [ ] 更完整的 capture group actions、scroll timeline、真实 pointer event sampling。
- [ ] 45 秒模板、更多公开仓库 visual adapters、封面人工审核工作流。
