'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
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
  EyeOutlined,
  HistoryOutlined,
  LoadingOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { api, ApiError } from '@/lib/request';
import { MarkdownView } from '@/components/MarkdownView';
import type { DocDetail } from '@/types/api';

const AUTOSAVE_DELAY = 1200;

/** 文档编辑器: 防抖自动保存 + 乐观锁冲突检测 + 历史版本 */
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
  const versionRef = useRef(1);

  useEffect(() => {
    setDoc(null);
    setConflict(null);
    setSavedAt(null);
    dirtyRef.current = false;
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

  // 防抖自动保存
  useEffect(() => {
    if (!doc || doc.myAction === 'read' || doc.myAction === null) return;
    if (!dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(), AUTOSAVE_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [title, content]);

  const markDirty = (fn: () => void) => {
    dirtyRef.current = true;
    fn();
  };

  const readonly = !doc || doc.myAction === 'read' || doc.myAction === null;

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
      content: '当前内容会先存入历史,再回退到所选版本',
      onOk: async () => {
        try {
          const res = await api.post<{ version: number }>(
            `/documents/${docId}/versions/${v}/restore`,
          );
          const d = await api.get<DocDetail>(`/documents/${docId}`, { cacheMs: 0 });
          setDoc(d);
          setTitle(d.title);
          setContent(d.content);
          versionRef.current = d.version ?? res.version;
          message.success(`已恢复到 v${v}`);
          setVersionsOpen(false);
        } catch (e: any) {
          message.error(e.message);
        }
      },
    });
  };

  if (!doc) return <div style={{ padding: 40 }}><Empty description="选择左侧文档开始编辑" /></div>;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #eef0f4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Input
            size="large"
            variant="borderless"
            value={title}
            readOnly={readonly}
            onChange={(e) => markDirty(() => setTitle(e.target.value))}
            style={{ fontWeight: 700, fontSize: 18, padding: 0 }}
            placeholder="文档标题"
          />
          <Space size={4}>
            {saving ? (
              <Tag icon={<LoadingOutlined />} color="processing">保存中</Tag>
            ) : savedAt ? (
              <Tag icon={<CheckCircleOutlined />} color="success">已保存 {savedAt}</Tag>
            ) : (
              <Tag icon={<ClockCircleOutlined />}>v{versionRef.current}</Tag>
            )}
            {!readonly && (
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
        {readonly ? (
          <MarkdownView content={content || '（空文档）'} />
        ) : preview ? (
          <MarkdownView content={content || '（空文档）'} />
        ) : (
          <Input.TextArea
            value={content}
            onChange={(e) => markDirty(() => setContent(e.target.value))}
            placeholder="支持 Markdown 语法,编辑后 1.2 秒自动保存…"
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
                {!readonly && (
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
