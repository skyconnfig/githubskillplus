import React from "react";
import { AbsoluteFill } from "remotion";

export interface GithubCoverProps {
  title: string;
  repoUrl: string;
  variant: "16x9" | "4x3" | "3x4" | "9x16";
}

export const GithubCover: React.FC<GithubCoverProps> = ({ title, repoUrl, variant }) => {
  const portrait = variant === "3x4" || variant === "9x16";
  const tall = variant === "9x16";
  const repoName = repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  return (
    <AbsoluteFill style={{ background: "#061426", color: "#f8fbff", fontFamily: "Microsoft YaHei, Arial, sans-serif", overflow: "hidden", padding: tall ? 74 : portrait ? 76 : 68 }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 15% 12%, rgba(0,196,255,.4), transparent 34%), radial-gradient(circle at 90% 86%, rgba(231,0,216,.28), transparent 42%)" }} />
      <div style={{ position: "absolute", width: tall ? 820 : portrait ? 560 : 760, height: tall ? 760 : portrait ? 560 : 440, right: tall ? 130 : portrait ? 60 : 54, bottom: tall ? 220 : portrait ? 64 : 92, borderRadius: 32, background: "linear-gradient(145deg,#f7fbff,#d8e5f3)", transform: portrait ? "rotate(3deg)" : "rotate(-4deg)", boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
        <div style={{ height: 46, background: "#14283f", borderRadius: "32px 32px 0 0", display: "flex", alignItems: "center", padding: "0 22px", gap: 9 }}>
          <i style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <i style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <i style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <div style={{ padding: 36, color: "#10243b" }}>
          <div style={{ fontSize: tall ? 42 : portrait ? 30 : 36, fontWeight: 900 }}>{title}</div>
          <div style={{ marginTop: 22, width: "72%", height: 18, borderRadius: 9, background: "#b7c8da" }} />
          <div style={{ marginTop: 18, width: "52%", height: 18, borderRadius: 9, background: "#d1dce8" }} />
          <div style={{ marginTop: 54, display: "flex", gap: 18 }}>
            <span style={{ padding: "14px 20px", borderRadius: 14, background: "#ff00dc", color: "white", fontWeight: 900 }}>CAMERA</span>
            <span style={{ padding: "14px 20px", borderRadius: 14, background: "#1688ff", color: "white", fontWeight: 900 }}>ANNOTATION</span>
          </div>
          <div style={{ marginTop: 30, fontSize: 24, color: "#47637f", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>Playwright → Remotion</div>
        </div>
      </div>
      <div style={{ position: "relative", zIndex: 1, width: portrait ? "100%" : "52%" }}>
        <div style={{ fontSize: portrait ? 22 : 24, letterSpacing: 5, color: "#62ddff", fontWeight: 800 }}>GITHUB VIDEO STUDIO</div>
        <div style={{ marginTop: tall ? 48 : portrait ? 42 : 52, fontSize: tall ? 88 : portrait ? 74 : 86, lineHeight: 1.05, fontWeight: 950, letterSpacing: -2, textShadow: "0 8px 0 rgba(0,0,0,.35)" }}>{title}</div>
        <div style={{ marginTop: 32, fontSize: tall ? 38 : portrait ? 30 : 36, lineHeight: 1.35, color: "#ffffff", fontWeight: 800 }}>自动分析 README，生成可运镜的项目视频</div>
        <div style={{ marginTop: 34, display: "inline-block", padding: "12px 20px", border: "2px solid #ff00dc", borderRadius: 999, color: "#ff8bf3", fontSize: 22, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}>{repoName}</div>
      </div>
      <div style={{ position: "absolute", left: tall ? 74 : portrait ? 76 : 68, bottom: tall ? 86 : 42, color: "rgba(255,255,255,.62)", fontSize: 18 }}>IndexTTS · bbox framing · SVG hand-drawn motion</div>
    </AbsoluteFill>
  );
};
