export {};

declare global {
  interface Window {
    videoStudio: {
      runPipeline(request: { url: string; template: "12s" | "30s" | "45s" | "60s"; aspect: "16:9" | "4:3" | "3:4" | "9:16"; offline: boolean }): Promise<{ code: number }>;
      loadProject(url: string): Promise<Record<string, unknown>>;
      cancel(): Promise<boolean>;
      onOutput(listener: (payload: { stream: "stdout" | "stderr"; text: string }) => void): () => void;
      onDone(listener: (payload: { code: number }) => void): () => void;
    };
  }
}
