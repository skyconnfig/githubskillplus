import React from "react";
import { Composition } from "remotion";
import { GithubDemo, type GithubDemoProps } from "./compositions/GithubDemo.js";
import { GithubCover, type GithubCoverProps } from "./compositions/GithubCover.js";

const defaultProps: GithubDemoProps = {
  captureVideo: "capture.mp4",
  narrationAudio: "narration.wav",
  captureStartMs: 0,
  cameraTrack: { durationMs: 12000, frames: [{ timeMs: 0, pose: { scale: 1, cx: 0.5, cy: 0.48 }, rotation: 0 }] },
  captureEvents: [],
  storyboard: { scenes: [] },
  subtitles: [],
  showAnnotations: true,
  showCursor: true,
  showSubtitles: true,
  includeAudio: true,
};

const defaultCoverProps: GithubCoverProps = { title: "GitHub 项目", repoUrl: "https://github.com/owner/repo", variant: "4x3" };

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="GithubDemo" component={GithubDemo as unknown as React.FC<Record<string, unknown>>} durationInFrames={360} fps={30} width={1440} height={1080} defaultProps={defaultProps} />
    <Composition id="GithubCover4x3" component={GithubCover as unknown as React.FC<Record<string, unknown>>} durationInFrames={1} fps={30} width={1200} height={900} defaultProps={defaultCoverProps} />
    <Composition id="GithubCover3x4" component={GithubCover as unknown as React.FC<Record<string, unknown>>} durationInFrames={1} fps={30} width={900} height={1200} defaultProps={{ ...defaultCoverProps, variant: "3x4" }} />
  </>
);
