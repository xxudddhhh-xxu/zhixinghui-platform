'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Space,
  Switch,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExportOutlined,
  EyeOutlined,
  HistoryOutlined,
  LoadingOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api, ApiError, API_BASE, getToken } from '@/lib/request';
import { useCollabDoc, CollabMember, CollabStatus } from '@/lib/collab';
import { MarkdownView } from '@/components/MarkdownView';
import type { DocDetail } from '@/types/api';

const AUTOSAVE_DELAY = 1200;

const AVATAR_COLORS = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#1677ff'];
const colorFor = (id: string) =>
  AVATAR_COLORS[id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

/**
 * 文档编辑器:
 * - 协同模式(默认):多人实时合流(Yjs CRDT),服务端权威落库,在线头像 + 输入状态;
 * - 降级模式:WebSocket 不可用或被踢出时,回退为"防抖自动保存 + 乐观锁冲突检测"。
 */
export default function DocEditor({ docId, onChanged }: { docId: string; onChanged?: () => void }) {
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latestVersion: number } | null>(null);
  const [preview, setPreview] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const timerRef = useRef<any>(null);
  const dirtyRef = useRef(false);
  const titleDirtyRef = useRef(false);
  const versionRef = useRef(1);
  const textAreaRef = useRef<any>(null);

  // ===== 协同状态 =====
  const [members, setMembers] = useState<CollabMember[]>([]);
  const [editingPeers, setEditingPeers] = useState<Record<string, { nickname: string; until: number }>>({});
  const [collabEpoch, setCollabEpoch] = useState(0);
  const [collabDowngraded, setCollabDowngraded] = useState(false);
  const fallbackToastRef = useRef(false);

  useEffect(() => {
    setDoc(null);
    setConflict(null);
    setSavedAt(null);
    setMembers([]);
    setEditingPeers({});
    setCollabDowngraded(false);
    dirtyRef.current = false;
    titleDirtyRef.current = false;
    (async () => {
      try {
        const d = await api.get<DocDetail>(`/documents/${docId}`, { cacheMs: 0 });
        setDoc(d);
        setTitle(d.title);
        setContent(d.content);
        versionRef.current = d.version;
      } catch (e: any) {
        message.error(e.message);
      }
    })();
  }, [docId]);

  /** 远端合流到达:更新全文并平移本地光标(变化点在光标左侧时) */
  const applyRemote = (next: string, meta: { pos: number; delta: number }) => {
    const el = textAreaRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
    setContent((prev) => {
      if (prev === next) return prev;
      if (el && document.activeElement === el) {
        const sel = el.selectionStart;
        let cursor = sel > meta.pos ? sel + meta.delta : sel;
        if (cursor < meta.pos) cursor = meta.pos;
        requestAnimationFrame(() => {
          try {
            if (document.activeElement === el) el.setSelectionRange(cursor, cursor);
          } catch {}
        });
      }
      return next;
    });
  };

  const collabHandlers = {
    onRemoteChange: applyRemote,
    onJoined: (version: number) => {
      versionRef.current = version;
      setConflict(null);
    },
    onSaved: (version: number) => {
      versionRef.current = version;
      dirtyRef.current = false;
      setSavedAt(new Date().toLocaleTimeString('zh-CN'));
    },
    onMembers: (list: CollabMember[]) => {
      setMembers(list);
      // 离房成员的输入状态一并清除
      setEditingPeers((prev) => {
        const ids = new Set(list.map((m) => m.userId));
        const next: typeof prev = {};
        Object.entries(prev).forEach(([k, v]) => {
          if (ids.has(k)) next[k] = v;
        });
        return next;
      });
    },
    onAwareness: (peer: { userId: string; nickname: string; editing: boolean }) => {
      setEditingPeers((prev) => {
        const next = { ...prev };
        if (peer.editing) next[peer.userId] = { nickname: peer.nickname, until: Date.now() + 4000 };
        else delete next[peer.userId];
        return next;
      });
    },
    onKicked: (reason: 'permission' | 'downgraded' | 'refresh') => {
      if (reason === 'downgraded') {
        setCollabDowngraded(true);
        message.warning('你的权限已变更,已切换为只读模式');
      } else if (reason === 'refresh') {
        message.warning('文档已被他人更新,正在同步最新内容');
        setCollabEpoch((e) => e + 1); // 丢弃本地内存态,按数据库新状态重建协同
      } else {
        message.error('你已无该文档的访问权限');
      }
    },
    onFallback: () => {
      if (!fallbackToastRef.current) {
        fallbackToastRef.current = true;
        message.info('实时协同暂不可用,已切换为自动保存模式');
      }
    },
  };

  const { status: collabStatus, applyLocalEdit, notifyEditing } = useCollabDoc(
    docId,
    !!doc,
    collabHandlers,
    collabEpoch,
  );
  const collabLive = collabStatus === 'live';

  /** 协同模式的标题防抖保存(不带 content,协同全文由服务端权威落库);409 时带最新版本重试一次 */
  const saveTitleOnly = async (retryVersion?: number) => {
    if (!doc) return;
    try {
      const res = await api.patch<{ version: number }>(`/documents/${docId}`, {
        title,
        version: retryVersion ?? versionRef.current,
      });
      versionRef.current = res.version;
      titleDirtyRef.current = false;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 || err.code === 4090) {
        let latest = versionRef.current + 1;
        try {
          latest = JSON.parse(err.message).latestVersion ?? latest;
        } catch {}
        if (retryVersion === undefined) return saveTitleOnly(latest);
      } else {
        message.error(err.message || '标题保存失败');
      }
    }
  };

  const save = async (overriddenVersion?: number) => {
    if (!doc) return;
    setSaving(true);
    try {
      const res = await api.patch<{ version: number }>(`/documents/${docId}`, {
        title,
        content,
        version: overriddenVersion ?? versionRef.current,
      });
      versionRef.current = res.version;
      dirtyRef.current = false;
      titleDirtyRef.current = false;
      setSavedAt(new Date().toLocaleTimeString('zh-CN'));
      setConflict(null);
      onChanged?.();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 || err.code === 4090) {
        let latest = versionRef.current + 1;
        try {
          const parsed = JSON.parse(err.message);
          latest = parsed.latestVersion ?? latest;
        } catch {}
        setConflict({ latestVersion: latest });
      } else {
        message.error(err.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  // 降级/未连接:原"防抖全量保存"路径(协同模式跳过,内容由服务端权威落库)
  useEffect(() => {
    if (collabLive) return;
    if (!doc || doc.myAction === 'read' || doc.myAction === null) return;
    if (!dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(), AUTOSAVE_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, content, collabLive]);

  // 协同模式:仅标题防抖保存
  useEffect(() => {
    if (!collabLive || !doc || collabDowngraded) return;
    if (doc.myAction === 'read' || doc.myAction === null) return;
    if (!titleDirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveTitleOnly(), AUTOSAVE_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, collabLive, collabDowngraded]);

  // 输入状态过期清理(对端异常断开时兜底)
  useEffect(() => {
    const t = setInterval(() => {
      setEditingPeers((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        let changed = false;
        Object.entries(prev).forEach(([k, v]) => {
          if (v.until > now) next[k] = v;
          else changed = true;
        });
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const markDirty = (fn: () => void) => {
    dirtyRef.current = true;
    titleDirtyRef.current = true;
    fn();
  };

  const readonly = !doc || doc.myAction === 'read' || doc.myAction === null;
  const editorLocked = readonly || collabDowngraded;
  const typingNames = Object.values(editingPeers).map((p) => p.nickname);

  const loadVersions = async () => {
    try {
      setVersions(await api.get(`/documents/${docId}/versions`, { cacheMs: 0 }));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const restore = (v: number) => {
    Modal.confirm({
      title: `恢复到版本 v${v}?`,
      content: '当前内容会先存入历史,再回退到所选版本;若有人正在协同编辑,会同步收到更新',
      onOk: async () => {
        try {
          await api.post(`/documents/${docId}/versions/${v}/restore`);
          setCollabEpoch((e) => e + 1); // 本地立即重建协同态,服务端踢出事件到达后为幂等重放
          const d = await api.get<DocDetail>(`/documents/${docId}`, { cacheMs: 0 });
          setDoc(d);
          setTitle(d.title);
          setContent(d.content);
          versionRef.current = d.version;
          message.success(`已恢复到 v${v}`);
          setVersionsOpen(false);
        } catch (e: any) {
          message.error(e.message);
        }
      },
    });
  };

  if (!doc) return <div style={{ padding: 40 }}><Empty description="选择左侧文档开始编辑" /></div>;

  // 导出: 鉴权 fetch 拿 blob 触发浏览器下载(md 原文 / html 网页 / Word 兼容 doc)
  const doExport = async (fmt: 'md' | 'html' | 'doc') => {
    try {
      const res = await fetch(`${API_BASE}/documents/${docId}/export?format=${fmt}`, {
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      });
      if (!res.ok) throw new Error(`导出失败 (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      let name = `${title || 'document'}.${fmt}`;
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      if (m) name = decodeURIComponent(m[1]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${name}`);
    } catch (e: any) {
      message.error(e.message || '导出失败');
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ padding: '12px 20px 0', borderBottom: '1px solid #eef0f4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Input
            size="large"
            variant="borderless"
            value={title}
            readOnly={editorLocked}
            onChange={(e) => markDirty(() => setTitle(e.target.value))}
            style={{ fontWeight: 700, fontSize: 18, padding: 0 }}
            placeholder="文档标题"
          />
          <Space size={4}>
            {collabLive ? (
              <Tag icon={<ThunderboltOutlined />} color="green">实时协同</Tag>
            ) : collabStatus === 'connecting' ? (
              <Tag icon={<LoadingOutlined />} color="processing">协同连接中</Tag>
            ) : (
              <Tag color="orange">离线自动保存</Tag>
            )}
            {saving ? (
              <Tag icon={<LoadingOutlined />} color="processing">保存中</Tag>
            ) : savedAt ? (
              <Tag icon={<CheckCircleOutlined />} color="success">已保存 {savedAt}</Tag>
            ) : (
              <Tag icon={<ClockCircleOutlined />}>v{versionRef.current}</Tag>
            )}
            {!editorLocked && !collabLive && (
              <Tooltip title="立即保存">
                <Button size="small" icon={<SaveOutlined />} onClick={() => save()} />
              </Tooltip>
            )}
            <Tooltip title={preview ? '编辑模式' : '预览模式'}>
              <Button
                size="small"
                type={preview ? 'primary' : 'default'}
                icon={<EyeOutlined />}
                onClick={() => setPreview(!preview)}
              />
            </Tooltip>
            <Tooltip title="历史版本">
              <Button size="small" icon={<HistoryOutlined />} onClick={() => { setVersionsOpen(true); loadVersions(); }} />
            </Tooltip>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'md', label: 'Markdown (.md)', onClick: () => doExport('md') },
                  { key: 'html', label: '网页 (.html)', onClick: () => doExport('html') },
                  { key: 'doc', label: 'Word (.doc)', onClick: () => doExport('doc') },
                ],
              }}
            >
              <Tooltip title="导出文档">
                <Button size="small" icon={<ExportOutlined />} />
              </Tooltip>
            </Dropdown>
            {doc.myAction === 'manage' && (
              <Tooltip title={doc.isPublic ? '已公开(ISR 页面)' : '未公开'}>
                <Switch
                  size="small"
                  checked={doc.isPublic}
                  checkedChildren="公开"
                  unCheckedChildren="私有"
                  onChange={async (v) => {
                    try {
                      await api.patch(`/documents/${docId}`, { isPublic: v, version: versionRef.current });
                      setDoc({ ...doc, isPublic: v });
                      versionRef.current += 1;
                      dirtyRef.current = false;
                      if (v) message.success(`已公开,访问 /docs/${docId}`);
                      else message.success('已转为私有');
                    } catch (e: any) {
                      message.error(e.message);
                    }
                  }}
                />
              </Tooltip>
            )}
          </Space>
        </div>
        {/* 协同状态条:在线成员头像 + 输入状态 */}
        {(collabLive || collabStatus === 'connecting') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <Avatar.Group maxCount={6} size="small">
              {members.map((m) => (
                <Tooltip key={m.userId} title={m.nickname}>
                  <Avatar style={{ backgroundColor: colorFor(m.userId), fontSize: 12 }}>
                    {m.nickname.slice(0, 1)}
                  </Avatar>
                </Tooltip>
              ))}
            </Avatar.Group>
            {members.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {members.length} 人在线
              </Typography.Text>
            )}
            {typingNames.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {typingNames.join('、')} 正在输入…
              </Typography.Text>
            )}
            {collabDowngraded && (
              <Tag color="orange" style={{ marginInlineEnd: 0 }}>只读(权限已变更)</Tag>
            )}
          </div>
        )}
      </div>

      {conflict && (
        <Alert
          type="warning"
          showIcon
          closable
          message="检测到并发编辑冲突"
          description={`他人已将文档更新到 v${conflict.latestVersion}。可选择加载最新内容,或以当前编辑内容覆盖(对方改动会存入历史版本)。`}
          action={
            <Space>
              <Button
                size="small"
                onClick={async () => {
                  const d = await api.get<DocDetail>(`/documents/${docId}`, { cacheMs: 0 });
                  setDoc(d); setTitle(d.title); setContent(d.content);
                  versionRef.current = d.version;
                  dirtyRef.current = false;
                  setConflict(null);
                }}
              >
                加载最新
              </Button>
              <Button size="small" danger onClick={() => save(conflict.latestVersion)}>
                覆盖保存
              </Button>
            </Space>
          }
          style={{ margin: '8px 20px' }}
        />
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 20px 30px' }}>
        {editorLocked ? (
          <MarkdownView content={content || '（空文档）'} />
        ) : preview ? (
          <MarkdownView content={content || '（空文档）'} />
        ) : (
          <Input.TextArea
            ref={textAreaRef}
            value={content}
            onChange={(e) => {
              const v = e.target.value;
              if (collabLive) {
                applyLocalEdit(v); // diff 压缩写入 Y.Text 并广播
                setContent(v);
                notifyEditing();
              } else {
                markDirty(() => setContent(v));
              }
            }}
            placeholder={
              collabLive
                ? '支持 Markdown 语法,多人实时协同编辑中…'
                : '支持 Markdown 语法,编辑后 1.2 秒自动保存…'
            }
            autoSize={{ minRows: 22, maxRows: 40 }}
            style={{ fontSize: 14.5, lineHeight: 1.8, fontFamily: 'inherit' }}
          />
        )}
      </div>

      <Drawer
        title="历史版本"
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        width={380}
      >
        {versions.length === 0 && <Empty description="暂无历史版本" />}
        <Timeline
          items={versions.map((v) => ({
            dot: <HistoryOutlined />,
            children: (
              <div key={v.id}>
                <Typography.Text strong>v{v.version}</Typography.Text>
                <span style={{ color: '#98a1af', marginLeft: 8, fontSize: 12 }}>
                  {new Date(v.createdAt).toLocaleString('zh-CN')}
                </span>
                <div style={{ margin: '4px 0 8px' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {v.title} · {v.content?.slice(0, 60) || '（空）'}…
                  </Typography.Text>
                </div>
                {!editorLocked && (
                  <Button size="small" onClick={() => restore(v.version)}>
                    恢复此版本
                  </Button>
                )}
              </div>
            ),
          }))}
        />
      </Drawer>
    </div>
  );
}
