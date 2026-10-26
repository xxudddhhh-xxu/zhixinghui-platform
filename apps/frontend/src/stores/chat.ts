'use client';

import { create } from 'zustand';

export interface StreamToolTrace {
  name: string;
  arguments: any;
  result?: string;
}

export interface StreamingState {
  active: boolean;
  text: string;
  sources: { source: string; score: number; snippet: string }[];
  toolTrace: StreamToolTrace[];
  notice?: string;
  latencyMs?: number;
}

interface ChatState {
  sessionId: string | null;
  modelId: string;
  assistantId: string | null;
  kbIds: string[];
  tools: string[];
  streaming: StreamingState | null;
  setSession: (id: string | null) => void;
  setModel: (id: string) => void;
  setAssistant: (id: string | null) => void;
  setKbIds: (ids: string[]) => void;
  toggleTool: (key: string) => void;
  startStream: () => void;
  pushDelta: (t: string) => void;
  setSources: (s: StreamingState['sources']) => void;
  addTool: (t: StreamToolTrace) => void;
  setToolResult: (name: string, result: string) => void;
  setNotice: (n: string) => void;
  finishStream: (latencyMs?: number) => void;
  clearStream: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  modelId: 'glm-5.3',
  assistantId: null,
  kbIds: [],
  tools: [],
  streaming: null,

  setSession: (id) => set({ sessionId: id }),
  setModel: (id) => set({ modelId: id }),
  setAssistant: (id) => set({ assistantId: id }),
  setKbIds: (ids) => set({ kbIds: ids }),
  toggleTool: (key) =>
    set((s) => ({
      tools: s.tools.includes(key) ? s.tools.filter((t) => t !== key) : [...s.tools, key],
    })),

  startStream: () =>
    set({
      streaming: { active: true, text: '', sources: [], toolTrace: [] },
    }),
  pushDelta: (t) =>
    set((s) =>
      s.streaming ? { streaming: { ...s.streaming, text: s.streaming.text + t } } : {},
    ),
  setSources: (sources) =>
    set((s) => (s.streaming ? { streaming: { ...s.streaming, sources } } : {})),
  addTool: (tool) =>
    set((s) =>
      s.streaming
        ? { streaming: { ...s.streaming, toolTrace: [...s.streaming.toolTrace, tool] } }
        : {},
    ),
  setToolResult: (name, result) =>
    set((s) => {
      if (!s.streaming) return {};
      const trace = [...s.streaming.toolTrace];
      for (let i = trace.length - 1; i >= 0; i--) {
        if (trace[i].name === name && trace[i].result === undefined) {
          trace[i] = { ...trace[i], result };
          break;
        }
      }
      return { streaming: { ...s.streaming, toolTrace: trace } };
    }),
  setNotice: (notice) =>
    set((s) => (s.streaming ? { streaming: { ...s.streaming, notice } } : {})),
  finishStream: (latencyMs) =>
    set((s) =>
      s.streaming ? { streaming: { ...s.streaming, active: false, latencyMs } } : {},
    ),
  clearStream: () => set({ streaming: null }),
}));
