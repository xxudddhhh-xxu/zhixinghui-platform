'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  List,
  message,
  Modal,
  Popover,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  BookOutlined,
  DeleteOutlined,
  ExportOutlined,
  MessageOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/request';
import { useRouter } from 'next/navigation';
import { postSSE } from '@/lib/sse';
import { MarkdownView } from '@/components/MarkdownView';
import { useChatStore } from '@/stores/chat';
import type {
  AssistantItem,
  ChatMessageItem,
  ChatSessionItem,
  KnowledgeBaseItem,
  ModelItem,
} from '@/types/api';

const TOOL_OPTIONS = [
  { key: 'knowledge_search', label: '知识库检索', hint: '让模型主动查询私有知识库' },
  { key: 'calculator', label: '精确计算', hint: '四则运算精确求解' },
  { key: 'current_time', label: '当前时间', hint: '获取北京时间' },
];

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [assistants, setAssistants] = useState<AssistantItem[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBaseItem[]>([]);

  const {
    sessionId, setSession,
    modelId, setModel,
    assistantId, setAssistant,
    kbIds, setKbIds,
    tools, toggleTool,
    streaming, startStream, pushDelta, setSources, addTool, setToolResult, setNotice, finishStream, clearStream,
  } = useChatStore();

  const abortRef = useRef<{ abort: () => void } | null>(null);
  const listBottom = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    setSessions(await api.get('/chat/sessions', { cacheMs: 0 }));
  }, []);

  useEffect(() => {
    loadSessions();
    api.get<ModelItem[]>('/llm/models').then((list) => {
      setModels(list);
      if (list.length && !list.some((m) => m.id === modelId)) setModel(list[0].id);
    });
    api.get<AssistantItem[]>('/assistants').then(setAssistants);
    api.get<KnowledgeBaseItem[]>('/knowledge').then(setKbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    api.get<ChatMessageItem[]>(`/chat/sessions/${sessionId}/messages`, { cacheMs: 0 })
      .then((msgs) => {
        setMessages(msgs);
        const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.modelId);
        if (lastAssistant?.modelId) setModel(lastAssistant.modelId);
      })
      .catch(() => setMessages([]));
  }, [sessionId, setModel]);

  useEffect(() => {
    listBottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming?.text]);

  const newChat = () => {
    setSession(null);
    setMessages([]);
    clearStream();
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setInput('');
    setSending(true);
    startStream();

    const localUser: ChatMessageItem = {
      id: `local-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localUser]);

    try {
      const sse = await postSSE('/chat/stream', {
        sessionId: sessionId ?? undefined,
        content,
        modelId,
        assistantId: assistantId ?? undefined,
        kbIds: kbIds.length ? kbIds : undefined,
        tools: tools.length ? tools : undefined,
      }, {
        onEvent: (ev) => {
          switch (ev.type) {
            case 'meta':
              if (!sessionId) setSession(ev.sessionId);
              loadSessions();
              break;
            case 'delta':
              pushDelta(ev.text);
              break;
            case 'sources':
              setSources(ev.sources || []);
              break;
            case 'tool_start':
              addTool({ name: ev.name, arguments: ev.arguments });
              break;
            case 'tool_result':
              setToolResult(ev.name, ev.result);
              break;
            case 'notice':
              setNotice(ev.message);
              break;
            case 'error':
              message.error(ev.message);
              setNotice(ev.message);
              break;
            case 'done':
              finishStream(ev.latencyMs);
              break;
          }
        },
        onError: (e) => {
          message.error(e.message);
          setNotice(e.message);
        },
        onFinish: async () => {
          setSending(false);
          // 流结束后刷新消息(以服务端落库为准)
          const sid = useChatStore.getState().sessionId;
          const st = useChatStore.getState().streaming;
          const msgs = sid
            ? await api.get<ChatMessageItem[]>(`/chat/sessions/${sid}/messages`, { cacheMs: 0 }).catch(() => null)
            : null;
          if (msgs && msgs.length && msgs[msgs.length - 1].role === 'assistant') {
            setMessages(msgs);
          } else if (st?.text) {
            // 落库未就绪(如停止生成的竞态): 先用本地流式内容兜底,刷新后自然对齐服务端
            setMessages((prev) => [
              ...prev,
              {
                id: `local-a-${Date.now()}`,
                role: 'assistant',
                content: st.text,
                sources: st.sources,
                toolCalls: st.toolTrace,
                latencyMs: st.latencyMs,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          // 落库消息已接管渲染,必须清掉流式气泡,否则同一回答显示两遍
          clearStream();
          loadSessions();
        },
      });
      abortRef.current = sse;
    } catch (e: any) {
      setSending(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setSending(false);
    finishStream();
  };

  const activeAssistant = assistants.find((a) => a.id === assistantId);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', background: '#f5f6fa' }}>
      {/* 会话列表 */}
      <aside style={{ width: 250, background: '#fff', borderRight: '1px solid #eceef2', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12 }}>
          <Button block type="primary" icon={<PlusOutlined />} onClick={newChat}>
            新建对话
          </Button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setSession(s.id)}
              style={{
                padding: '9px 12px', margin: '2px 8px', borderRadius: 8, cursor: 'pointer',
                background: s.id === sessionId ? '#eef1ff' : 'transparent',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: 160 }}>
                {s.assistantId && assistants.some((a) => a.id === s.assistantId) ? (
                  <RobotOutlined style={{ marginRight: 5, color: '#3b5bff' }} />
                ) : (
                  <MessageOutlined style={{ marginRight: 5, color: '#8a92a2' }} />
                )}
                {s.title}
              </span>
              <DeleteOutlined
                style={{ color: '#b6bcc7', fontSize: 12 }}
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.delete(`/chat/sessions/${s.id}`);
                  if (s.id === sessionId) newChat();
                  loadSessions();
                }}
              />
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ color: '#98a1af', fontSize: 12.5, textAlign: 'center', marginTop: 20 }}>
              暂无历史会话
            </div>
          )}
        </div>
      </aside>

      {/* 消息区 */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 8%' }}>
          {messages.length === 0 && !streaming && (
            <div style={{ textAlign: 'center', marginTop: 90 }}>
              <RobotOutlined style={{ fontSize: 46, color: '#3b5bff' }} />
              <Typography.Title level={4} style={{ marginTop: 14 }}>
                {activeAssistant ? activeAssistant.name : '智能问答'}
              </Typography.Title>
              <Typography.Paragraph type="secondary">
                {activeAssistant?.greeting || '基于团队知识库的 RAG 智能问答,所有回答流式生成。先在右侧选择知识库,即可引用私有文档作答。'}
              </Typography.Paragraph>
              <Space wrap style={{ justifyContent: 'center' }}>
                {['出差住宿标准是多少?', '合同付款方式有哪些约定?', 'API 错误码 4090 是什么含义?'].map((q) => (
                  <Button key={q} onClick={() => send(q)} style={{ borderRadius: 16 }}>
                    {q}
                  </Button>
                ))}
              </Space>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}

          {/* 流式中的消息 */}
          {streaming && (
            <MessageBubble
              msg={{
                id: 'streaming',
                role: 'assistant',
                content: streaming.text || '…',
                createdAt: new Date().toISOString(),
              }}
              streaming={streaming}
            />
          )}
          <div ref={listBottom} />
        </div>

        {/* 输入区 */}
        <div style={{ borderTop: '1px solid #eceef2', background: '#fff', padding: '12px 8%' }}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="输入问题,Enter 发送,Shift+Enter 换行…"
            autoSize={{ minRows: 2, maxRows: 5 }}
            disabled={sending}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, alignItems: 'center' }}>
            <Space size={12}>
              <Select
                size="small"
                value={modelId}
                onChange={setModel}
                style={{ width: 180 }}
                options={models.map((m) => ({ value: m.id, label: m.label }))}
              />
              <Select
                size="small"
                allowClear
                placeholder="选择助手(选填)"
                value={assistantId}
                onChange={(v) => setAssistant(v ?? null)}
                style={{ width: 150 }}
                options={assistants.map((a) => ({ value: a.id, label: a.name }))}
              />
              <Popover
                trigger="click"
                content={
                  <div style={{ width: 230 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>知识库范围</div>
                    <Select
                      mode="multiple"
                      placeholder="选择引用的知识库"
                      value={kbIds}
                      onChange={setKbIds}
                      style={{ width: '100%', marginBottom: 12 }}
                      options={kbs.map((k) => ({ value: k.id, label: k.name }))}
                    />
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      <ToolOutlined /> 工具调用
                    </div>
                    {TOOL_OPTIONS.map((t) => (
                      <div key={t.key} style={{ padding: '3px 0' }}>
                        <Checkbox checked={tools.includes(t.key)} onChange={() => toggleTool(t.key)}>
                          {t.label}
                        </Checkbox>
                        <div style={{ fontSize: 11.5, color: '#98a1af', marginLeft: 24 }}>{t.hint}</div>
                      </div>
                    ))}
                  </div>
                }
              >
                <Button size="small" icon={<SettingOutlined />}>
                  检索与工具
                  {(kbIds.length > 0 || tools.length > 0) && (
                    <Tag style={{ marginLeft: 6 }} color="blue">
                      {kbIds.length + tools.length}
                    </Tag>
                  )}
                </Button>
              </Popover>
            </Space>
            {sending ? (
              <Button danger icon={<StopOutlined />} onClick={stop}>
                停止生成
              </Button>
            ) : (
              <Button type="primary" icon={<SendOutlined />} onClick={() => send()} disabled={!input.trim()}>
                发送
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** 引用来源标签: 可点击查看命中详情,关联团队文档时可跳转原文档 */
function SourceTags({ sources }: { sources: any[] }) {
  const router = useRouter();
  const [detail, setDetail] = useState<any | null>(null);
  return (
    <>
      <Space wrap size={6}>
        {sources.map((s: any, i: number) => (
          <Tag
            key={i}
            color="blue"
            style={{ cursor: 'pointer' }}
            onClick={() => setDetail(s)}
          >
            [{i + 1}] {s.source}
            {s.score != null && ` · ${(s.score * 100).toFixed(0)}%`}
          </Tag>
        ))}
      </Space>
      <Modal
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          detail?.documentId ? (
            <Button
              type="primary"
              icon={<ExportOutlined />}
              onClick={() => router.push(`/documents?teamId=${detail.teamId ?? ''}&docId=${detail.documentId}`)}
            >
              打开原文档
            </Button>
          ) : null
        }
        title={detail ? `引用详情 · ${detail.source}` : ''}
        width={560}
      >
        {detail && (
          <>
            <Space wrap style={{ marginBottom: 10 }}>
              <Tag color="blue">{detail.source}</Tag>
              {detail.score != null && (
                <Tag color={detail.score >= 0.5 ? 'green' : 'orange'}>
                  相关度 {Math.round(Math.min(detail.score, 1) * 100)}%
                </Tag>
              )}
            </Space>
            <div
              style={{
                maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap',
                fontSize: 13, lineHeight: 1.8, color: '#3c4353',
                background: '#f7f8fc', padding: 12, borderRadius: 8,
              }}
            >
              {detail.text || detail.snippet}
            </div>
            {!detail.documentId && (
              <Typography.Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 10 }}>
                该片段来自直接上传的文件,未关联团队文档
              </Typography.Text>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

function MessageBubble({
  msg,
  streaming,
}: {
  msg: ChatMessageItem;
  streaming?: { active: boolean; sources: any[]; toolTrace: any[]; notice?: string; latencyMs?: number };
}) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexDirection: isUser ? 'row-reverse' : 'row' }}>
      <Avatar
        style={{ background: isUser ? '#ff7d45' : '#3b5bff', flexShrink: 0 }}
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
      />
      <div style={{ maxWidth: '78%', minWidth: 0 }}>
        <div
          style={{
            background: isUser ? '#e8f0ff' : '#fff',
            padding: '10px 16px',
            borderRadius: 10,
            boxShadow: '0 1px 4px rgba(31,35,41,.05)',
            fontSize: 14.2,
          }}
        >
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
          ) : (
            <>
              <MarkdownView content={msg.content} />
              {streaming?.active && (
                <span className="cursor" style={{ display: 'inline-block', width: 2, height: 15, background: '#3b5bff', marginLeft: 2, animation: 'blink 0.9s infinite' }} />
              )}
            </>
          )}
        </div>

        {/* 工具调用轨迹 */}
        {!!streaming?.toolTrace?.length && (
          <Card size="small" style={{ marginTop: 8, background: '#fffdf5' }} title={<span style={{ fontSize: 12.5 }}><ToolOutlined /> 工具调用</span>}>
            {streaming.toolTrace.map((t, i) => (
              <div key={i} style={{ fontSize: 12.5, marginBottom: 4 }}>
                <ThunderboltOutlined style={{ color: '#fa8c16' }} /> <b>{t.name}</b>
                <span style={{ color: '#8a92a2' }}> {JSON.stringify(t.arguments)}</span>
                {t.result !== undefined && (
                  <Tooltip title={t.result}>
                    <Tag color="green" style={{ marginLeft: 6 }}>完成</Tag>
                  </Tooltip>
                )}
              </div>
            ))}
          </Card>
        )}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#8a92a2' }}>
            <ToolOutlined /> 调用工具: {msg.toolCalls.map((t: any) => t.name).join(', ')}
          </div>
        )}

        {/* 引用来源 */}
        {!!streaming?.sources?.length && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: '#8a92a2', marginBottom: 4 }}>
              <BookOutlined /> 引用来源(点击查看详情):
            </div>
            <SourceTags sources={streaming.sources} />
          </div>
        )}
        {msg.sources && msg.sources.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#8a92a2' }}>
            <BookOutlined style={{ marginRight: 4 }} />
            引用(点击查看详情):
            <div style={{ marginTop: 4 }}>
              <SourceTags sources={msg.sources} />
            </div>
            {typeof msg.latencyMs === 'number' && ` · 耗时 ${(msg.latencyMs / 1000).toFixed(1)}s`}
          </div>
        )}

        {streaming?.notice && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#d48806' }}>
            <WarningOutlined style={{ marginRight: 4 }} />
            {streaming.notice}
          </div>
        )}
        {!streaming && msg.modelId && (
          <div style={{ marginTop: 4, fontSize: 11.5, color: '#b6bcc7', textAlign: isUser ? 'right' : 'left' }}>
            {msg.modelId}
          </div>
        )}
      </div>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}
