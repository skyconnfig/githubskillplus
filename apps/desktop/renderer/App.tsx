import React, { useEffect, useMemo, useState } from "react";

type TemplateId = "12s" | "30s" | "45s" | "60s";
type Aspect = "16:9" | "4:3" | "3:4" | "9:16";
const stages = ["Analyze", "Evidence", "Script", "TTS", "Align", "Director", "Storyboard", "Capture", "Render", "QA"];

export function App(): React.ReactElement {
  const [url, setUrl] = useState("https://github.com/andrewluxem/ultrademo");
  const [template, setTemplate] = useState<TemplateId>("45s");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("等待生成。API key 只会由 Electron 主进程传给 pipeline。");
  const [project, setProject] = useState<Record<string, unknown>>({});
  const [activeStage, setActiveStage] = useState(-1);
  const scriptLines = useMemo(() => {
    const value = project.script;
    if (!value || typeof value !== "object") return [];
    const lines = (value as { lines?: unknown }).lines;
    return Array.isArray(lines) ? lines : [];
  }, [project.script]);

  useEffect(() => {
    const removeOutput = window.videoStudio.onOutput((payload) => { setOutput((current) => `${current}\n${payload.text}`.trim()); const match = payload.text.match(/(Analyze|Evidence|Script|TTS|Align|Director|Storyboard|Capture|Render|QA)/i); if (match) { const index = stages.findIndex((stage) => stage.toLowerCase() === match[1]?.toLowerCase()); if (index >= 0) setActiveStage(index); } });
    const removeDone = window.videoStudio.onDone((payload) => { setRunning(false); setOutput((current) => `${current}\n${payload.code === 0 ? "生成完成。" : `生成失败，退出码 ${payload.code}。`}`); void window.videoStudio.loadProject(url).then(setProject).catch(() => undefined); });
    return () => { removeOutput(); removeDone(); };
  }, [url]);

  async function generate(): Promise<void> {
    setRunning(true); setActiveStage(0); setOutput("开始运行 Director pipeline…");
    try { await window.videoStudio.runPipeline({ url, template, aspect, offline: false }); } catch (error) { setRunning(false); setOutput(error instanceof Error ? error.message : String(error)); }
  }

  function updateScript(index: number, text: string): void {
    const value = project.script;
    if (!value || typeof value !== "object") return;
    const next = structuredClone(value) as { lines?: Array<Record<string, unknown>> };
    if (next.lines?.[index]) next.lines[index]!.text = text;
    setProject({ ...project, script: next });
  }

  return <main className="studio"><aside className="sidebar"><div className="eyebrow">LOCAL DIRECTOR</div><h1>GitHub<br />Video Studio</h1><label>GitHub URL<input value={url} onChange={(event) => setUrl(event.target.value)} /></label><label>视频模板<select value={template} onChange={(event) => setTemplate(event.target.value as TemplateId)}>{["12s", "30s", "45s", "60s"].map((value) => <option key={value}>{value}</option>)}</select></label><label>输出比例<select value={aspect} onChange={(event) => setAspect(event.target.value as Aspect)}>{["16:9", "4:3", "3:4", "9:16"].map((value) => <option key={value}>{value}</option>)}</select></label><button className="primary" disabled={running} onClick={() => void generate()}>{running ? "正在生成…" : "生成视频"}</button>{running && <button className="ghost" onClick={() => void window.videoStudio.cancel()}>取消</button>}</aside><section className="canvas"><div className="canvas-head"><span>PROJECT DIRECTOR</span><span>{String(project.projectName ?? "未加载项目")}</span></div><div className="cards"><section className="panel"><h2>项目分析</h2><pre>{project.github ? JSON.stringify(project.github, null, 2) : "等待 Analyze…"}</pre></section><section className="panel"><h2>文案 <small>可编辑</small></h2>{scriptLines.length === 0 ? <p>等待 Script…</p> : scriptLines.map((line, index) => <textarea key={index} value={typeof (line as { text?: unknown }).text === "string" ? (line as { text: string }).text : ""} onChange={(event) => updateScript(index, event.target.value)} />)}</section><section className="panel storyboard"><h2>分镜</h2>{Array.isArray((project.storyboard as { scenes?: unknown } | undefined)?.scenes) ? ((project.storyboard as { scenes: Array<Record<string, unknown>> }).scenes).map((scene) => <article key={String(scene.id)}><strong>{String(scene.id)}</strong><span>{String(scene.narration ?? "")}</span><code>{JSON.stringify(scene.camera)}</code></article>) : <p>等待 Storyboard…</p>}</section></div><div className="preview"><div className="preview-bar"><span>PREVIEW</span><span>Storyboard single source of truth</span></div><div className="preview-screen"><span>{running ? "Director 正在捕获 GitHub 页面…" : "生成完成后可从 output 目录打开 final.mp4"}</span></div></div></section><aside className="status"><h2>Pipeline Status</h2>{stages.map((stage, index) => <div className={`status-row ${index < activeStage ? "done" : index === activeStage ? "active" : ""}`} key={stage}><span>{index < activeStage ? "✓" : index === activeStage ? "●" : "○"}</span>{stage}</div>)}<div className="log">{output}</div></aside></main>;
}
