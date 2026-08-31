import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const stages = ["分析 GitHub", "生成脚本", "生成分镜", "生成 TTS", "浏览器拍摄", "生成镜头", "生成字幕", "Remotion 渲染", "FFmpeg 合成", "完成"];

function App(): React.ReactElement {
  const [url, setUrl] = useState("https://github.com/andrewluxem/ultrademo");
  const [message, setMessage] = useState("输入 GitHub 地址后，从 CLI 或 Electron 主进程启动同一条流水线。");
  return <main className="app"><header><div className="eyebrow">LOCAL VIDEO PIPELINE</div><h1>GitHub Video Studio</h1><p>把公开 GitHub 项目变成有镜头、有重点、有旁白的解说视频。</p></header><section className="card"><label htmlFor="url">GitHub 地址</label><div className="row"><input id="url" value={url} onChange={(event) => setUrl(event.target.value)} /><button onClick={() => setMessage(`准备分析：${url}`)}>分析 GitHub</button></div><p className="hint">CLI 与桌面端共享同一 pipeline；API key 只留在主进程。</p></section><section className="card"><div className="section-title"><span>Pipeline</span><span className="status">等待开始</span></div><div className="stages">{stages.map((stage, index) => <div className="stage" key={stage}><span className="number">{String(index + 1).padStart(2, "0")}</span><span>{stage}</span></div>)}</div><div className="progress"><div /></div><p className="hint">{message}</p></section></main>;
}

createRoot(document.getElementById("root")!).render(<App />);
