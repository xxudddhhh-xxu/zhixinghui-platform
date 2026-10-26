export interface User {
  id: string;
  username: string;
  nickname: string;
  email?: string | null;
  globalRole: 'admin' | 'user';
  status: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string | null;
  myRole: 'owner' | 'admin' | 'editor' | 'viewer';
  createdAt: string;
}

export interface DocNode {
  id: string;
  parentId: string | null;
  teamId: string;
  title: string;
  docType: 'folder' | 'doc';
  isPublic: boolean;
  version: number;
  updatedAt: string;
  myAction: 'read' | 'write' | 'manage' | null;
}

export interface DocDetail extends DocNode {
  content: string;
  createdAt: string;
}

export interface KnowledgeBaseItem {
  id: string;
  teamId: string;
  name: string;
  description?: string | null;
  docCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface KbDocItem {
  id: string;
  kbId: string;
  documentId: string | null;
  sourceName: string;
  chunkCount: number;
  status: 'pending' | 'ready' | 'failed';
  createdAt: string;
}

export interface SearchHit {
  id: string;
  docId: string;
  text: string;
  score: number;
  source: string;
  kbId?: string;
  /** 命中片段来源的团队文档 ID(从团队文档入库时携带) */
  documentId?: string | null;
  teamId?: string | null;
}

export interface AssistantItem {
  id: string;
  name: string;
  role: string;
  personality: string;
  allowedTopics: string;
  deniedTopics: string;
  retrievalFirst: boolean;
  kbIds: string[] | null;
  greeting: string;
  defaultModelId: string | null;
  updatedAt: string;
}

export interface ChatSessionItem {
  id: string;
  title: string;
  assistantId: string | null;
  updatedAt: string;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  modelId?: string | null;
  sources?: any[] | null;
  toolCalls?: any[] | null;
  latencyMs?: number | null;
  createdAt: string;
}

export interface ModelItem {
  id: string;
  label: string;
  supportsTools: boolean;
}
