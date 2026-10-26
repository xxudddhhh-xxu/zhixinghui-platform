'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'react';
import { Button, Dropdown, Input, Modal, Select, Space, Tree, message } from 'antd';
import { docPublicHref } from '@/lib/docPublicHref';
import {
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOutlined,
  GlobalOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { api } from '@/lib/request';
import type { DocNode } from '@/types/api';

interface Props {
  teamId: string;
  selectedId: string | null;
  onSelect: (node: DocNode) => void;
  /** myAction==='manage' 时显示管理操作 */
  canManageTeam: boolean;
  canWriteTeam: boolean;
  /** 深链定位: 逐级加载祖先链并展开选中该文档(用于从检索命中跳转) */
  revealId?: string | null;
}

interface WrappedNode extends DocNode {
  children?: WrappedNode[];
  loaded?: boolean;
}

/** 树形文档组件: 子节点懒加载,按权限过滤操作按钮 */
export default function DocumentTree({ teamId, selectedId, onSelect, canManageTeam, canWriteTeam, revealId }: Props) {
  const [roots, setRoots] = useState<WrappedNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [createModal, setCreateModal] = useState<{ open: boolean; parentId: string | null; docType: 'folder' | 'doc' }>({ open: false, parentId: null, docType: 'doc' });
  const [newTitle, setNewTitle] = useState('');
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const uploadRef = useRef<any>(null);
  const uploadParent = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const revealedFor = useRef<string>('');

  // ===== 文档级授权(跨团队白名单共享) =====
  const [grantDoc, setGrantDoc] = useState<{ id: string; title: string } | null>(null);
  const [docMembers, setDocMembers] = useState<{ userId: string; username: string; nickname: string; role: string }[]>([]);
  const [candidates, setCandidates] = useState<{ id: string; username: string; nickname: string }[]>([]);
  const [grantUserId, setGrantUserId] = useState<string | null>(null);
  const [grantRole, setGrantRole] = useState<'editor' | 'viewer'>('viewer');

  const openGrant = async (node: WrappedNode) => {
    setGrantDoc({ id: node.id, title: node.title });
    setGrantUserId(null);
    try {
      const [members, cands] = await Promise.all([
        api.get<any[]>(`/documents/${node.id}/members`, { cacheMs: 0 }),
        api.get<any[]>(`/teams/${teamId}/candidates`, { cacheMs: 0 }).catch(() => []),
      ]);
      setDocMembers(members);
      setCandidates(cands);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const doGrant = async (userId: string, role: 'editor' | 'viewer' | null) => {
    if (!grantDoc) return;
    try {
      await api.post(`/documents/${grantDoc.id}/members`, { userId, role: role ?? '' });
      message.success(role ? '授权成功(即时生效)' : '已移除授权');
      setGrantUserId(null);
      setDocMembers(await api.get<any[]>(`/documents/${grantDoc.id}/members`, { cacheMs: 0 }));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const loadChildren = useCallback(
    async (parentId: string | null): Promise<WrappedNode[]> => {
      const list = await api.get<DocNode[]>(
        `/documents?teamId=${teamId}${parentId ? `&parentId=${parentId}` : ''}`,
        { cacheMs: 0 },
      );
      return list.map((n) => ({ ...n, loaded: n.docType !== 'folder' }));
    },
    [teamId],
  );

  const refreshRoot = useCallback(async () => {
    setLoading(true);
    try {
      setRoots(await loadChildren(null));
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [loadChildren]);

  useEffect(() => {
    setRoots([]);
    setExpandedKeys([]);
    refreshRoot();
  }, [refreshRoot]);

  // 深链定位: 拉取祖先链 → 逐级补齐 children → 展开路径并选中目标文档
  useEffect(() => {
    if (!revealId || !teamId) return;
    const marker = `${teamId}:${revealId}`;
    if (revealedFor.current === marker) return;
    revealedFor.current = marker;
    let cancelled = false;
    (async () => {
      try {
        const chain: DocNode[] = [];
        let cur: string | null = revealId;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          seen.add(cur);
          const d = await api.get<DocNode>(`/documents/${cur}`, { cacheMs: 0 });
          chain.unshift(d);
          cur = d.parentId ?? null;
        }
        if (cancelled) return;
        const folderIds = chain.slice(0, -1).map((c) => c.id);
        let level = await loadChildren(null);
        for (const fid of folderIds) {
          const children = await loadChildren(fid);
          level = level.map((n) => (n.id === fid ? { ...n, children, loaded: true } : n));
        }
        if (cancelled) return;
        setRoots(level);
        setExpandedKeys(folderIds);
        const target = chain[chain.length - 1];
        if (target) onSelect(target);
      } catch (e: any) {
        if (!cancelled) message.error(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId, teamId]);

  const updateNodeIn = (nodes: WrappedNode[], id: string, fn: (n: WrappedNode) => WrappedNode): WrappedNode[] =>
    nodes.map((n) => {
      if (n.id === id) return fn(n);
      if (n.children) return { ...n, children: updateNodeIn(n.children, id, fn) };
      return n;
    });

  const toDataNode = (nodes: WrappedNode[]): DataNode[] =>
    nodes.map((n) => ({
      key: n.id,
      title: renderTitle(n),
      icon: n.docType === 'folder' ? <FolderOutlined /> : <FileTextOutlined />,
      isLeaf: n.docType !== 'folder',
      children: n.children ? toDataNode(n.children) : undefined,
    }));

  const doCreate = async () => {
    if (!newTitle.trim()) return message.warning('请输入名称');
    try {
      const doc = await api.post('/documents', {
        teamId,
        parentId: createModal.parentId,
        title: newTitle.trim(),
        docType: createModal.docType,
      });
      message.success('创建成功');
      setCreateModal({ ...createModal, open: false });
      setNewTitle('');
      if (createModal.parentId === null) {
        setRoots((prev) => [...prev, { ...doc, loaded: doc.docType !== 'folder' }]);
      } else {
        await refreshSubtree(createModal.parentId);
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const refreshSubtree = async (parentId: string) => {
    const children = await loadChildren(parentId);
    setRoots((prev) => updateNodeIn(prev, parentId, (n) => ({ ...n, children, loaded: true })));
  };

  const doDelete = (node: WrappedNode) => {
    Modal.confirm({
      title: `确认删除「${node.title}」?`,
      content: node.docType === 'folder' ? '其下所有子文档将一并删除' : undefined,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/documents/${node.id}`);
          message.success('已删除');
          if (node.parentId) await refreshSubtree(node.parentId);
          else refreshRoot();
          if (selectedId === node.id) window.location.reload();
        } catch (e: any) {
          message.error(e.message);
        }
      },
    });
  };

  const doRename = async () => {
    if (!rename) return;
    try {
      const detail = await api.get(`/documents/${rename.id}`, { cacheMs: 0 });
      await api.patch(`/documents/${rename.id}`, {
        title: rename.title,
        version: detail.version,
      });
      message.success('已重命名');
      const updated = await api.get<DocNode>(`/documents/${rename.id}`, { cacheMs: 0 });
      setRoots((prev) => updateNodeIn(prev, rename.id, (n) => ({ ...n, title: updated.title })));
      setRename(null);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const onUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('teamId', teamId);
    fd.append('parentId', uploadParent.current ?? '');
    try {
      const doc = await api.post('/documents/upload', fd);
      message.success(`已导入「${doc.title}」`);
      if (uploadParent.current) await refreshSubtree(uploadParent.current);
      else setRoots((prev) => [...prev, { ...doc, loaded: true }]);
    } catch (err: any) {
      message.error(err.message);
    } finally {
      e.target.value = '';
    }
  };

  const renderTitle = (node: WrappedNode) => {
    const canWrite = node.myAction === 'write' || node.myAction === 'manage' || canWriteTeam;
    const canManage = node.myAction === 'manage' || canManageTeam;
    const actions: any[] = [];
    if (canWrite && node.docType === 'folder') {
      actions.push({
        key: 'new-doc',
        label: '新建文档',
        icon: <FileAddOutlined />,
        onClick: () => setCreateModal({ open: true, parentId: node.id, docType: 'doc' }),
      });
      actions.push({
        key: 'upload',
        label: '导入文件',
        icon: <UploadOutlined />,
        onClick: () => {
          uploadParent.current = node.id;
          fileInputRef.current?.click();
        },
      });
    }
    if (canWrite) {
      actions.push({
        key: 'rename',
        label: '重命名',
        icon: <EditOutlined />,
        onClick: () => setRename({ id: node.id, title: node.title }),
      });
    }
    if (node.isPublic) {
      actions.push({ key: 'public-view', label: '查看公开页', icon: <GlobalOutlined />, onClick: () => window.open(docPublicHref(node.id), '_blank') });
    }
    if (canManage && node.docType === 'doc') {
      actions.push({
        key: 'grant',
        label: '授权共享',
        icon: <UserAddOutlined />,
        onClick: () => openGrant(node),
      });
    }
    if (canManage) {
      actions.push({ type: 'divider' });
      actions.push({ key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => doDelete(node) });
    }

    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            maxWidth: 190,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            verticalAlign: 'bottom',
          }}
        >
          {node.title}
          {node.isPublic && <GlobalOutlined style={{ color: '#52c41a', marginLeft: 5, fontSize: 12 }} />}
        </span>
        {actions.length > 0 && (
          <Dropdown menu={{ items: actions }} trigger={['click']}>
            <EllipsisOutlined
              onClick={(e) => e.stopPropagation()}
              style={{ color: '#98a1af', padding: '0 3px' }}
            />
          </Dropdown>
        )}
      </span>
    );
  };

  const filteredRoots = useMemo(() => {
    if (!keyword.trim()) return roots;
    const kw = keyword.trim().toLowerCase();
    const filter = (nodes: WrappedNode[]): WrappedNode[] => {
      const out: WrappedNode[] = [];
      for (const n of nodes) {
        const children = n.children ? filter(n.children) : [];
        if (n.title.toLowerCase().includes(kw) || children.length) {
          out.push({ ...n, children: children.length ? children : n.children });
        }
      }
      return out;
    };
    return filter(roots);
  }, [roots, keyword]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
        <Input
          size="small"
          prefix={<SearchOutlined style={{ color: '#b6bcc7' }} />}
          placeholder="搜索本团队文档"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
        />
        <Button size="small" icon={<ReloadOutlined />} onClick={refreshRoot} loading={loading} />
      </div>

      {(canWriteTeam || canManageTeam) && (
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 8 }}>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<PlusOutlined />}
            onClick={() => setCreateModal({ open: true, parentId: null, docType: 'doc' })}
          >
            文档
          </Button>
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            onClick={() => setCreateModal({ open: true, parentId: null, docType: 'folder' })}
          >
            文件夹
          </Button>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={() => {
              uploadParent.current = null;
              fileInputRef.current?.click();
            }}
          >
            导入
          </Button>
          <input ref={fileInputRef} type="file" hidden accept=".txt,.md,.pdf,.docx" onChange={onUpload} />
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
        <Tree
          showIcon
          blockNode
          selectedKeys={selectedId ? [selectedId] : []}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpandedKeys(keys as Key[])}
          treeData={toDataNode(filteredRoots)}
          loadData={async (node: any) => {
            const children = await loadChildren(node.key);
            setRoots((prev) => updateNodeIn(prev, node.key as string, (n) => ({ ...n, children, loaded: true })));
          }}
          onSelect={(keys, info: any) => {
            const raw = info.node as any;
            if (raw.isLeaf !== undefined && !raw.isLeaf) return; // 文件夹仅展开
            const found = findNode(roots, keys[0] as string);
            if (found) onSelect(found);
          }}
        />
        {!loading && roots.length === 0 && (
          <div style={{ color: '#98a1af', textAlign: 'center', padding: 24, fontSize: 13 }}>
            暂无文档,点击上方按钮创建
          </div>
        )}
      </div>

      <Modal
        title={createModal.docType === 'folder' ? '新建文件夹' : `新建文档${createModal.parentId ? '(子文档)' : ''}`}
        open={createModal.open}
        onOk={doCreate}
        onCancel={() => setCreateModal({ ...createModal, open: false })}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="请输入名称"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onPressEnter={doCreate}
          autoFocus
        />
      </Modal>

      <Modal
        title="重命名"
        open={!!rename}
        onOk={doRename}
        onCancel={() => setRename(null)}
        okText="确定"
        cancelText="取消"
      >
        <Input
          value={rename?.title}
          onChange={(e) => setRename((r) => (r ? { ...r, title: e.target.value } : r))}
          onPressEnter={doRename}
          autoFocus
        />
      </Modal>

      <Modal
        title={`授权共享 · ${grantDoc?.title ?? ''}`}
        open={!!grantDoc}
        footer={null}
        onCancel={() => setGrantDoc(null)}
        width={500}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Select
            showSearch
            style={{ flex: 1 }}
            placeholder="选择要授权的用户(非本团队)"
            value={grantUserId ?? undefined}
            onChange={setGrantUserId}
            filterOption={(input, opt) =>
              String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={candidates
              .filter((c) => !docMembers.some((m) => m.userId === c.id))
              .map((c) => ({ value: c.id, label: `${c.nickname}(${c.username})` }))}
          />
          <Select
            style={{ width: 104 }}
            value={grantRole}
            onChange={setGrantRole}
            options={[
              { value: 'editor', label: '可编辑' },
              { value: 'viewer', label: '只读' },
            ]}
          />
          <Button type="primary" disabled={!grantUserId} onClick={() => grantUserId && doGrant(grantUserId, grantRole)}>
            授权
          </Button>
        </div>
        {docMembers.length === 0 && (
          <div style={{ color: '#98a1af', textAlign: 'center', padding: 16, fontSize: 13 }}>
            暂无授权用户
          </div>
        )}
        {docMembers.map((m) => (
          <div
            key={m.userId}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #f0f2f5' }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.nickname}
              <span style={{ color: '#98a1af', fontSize: 12 }}>({m.username})</span>
            </span>
            <Select
              size="small"
              style={{ width: 96 }}
              value={m.role}
              onChange={(v: 'editor' | 'viewer') => doGrant(m.userId, v)}
              options={[
                { value: 'editor', label: '可编辑' },
                { value: 'viewer', label: '只读' },
              ]}
            />
            <Button size="small" type="text" danger onClick={() => doGrant(m.userId, null)}>
              移除
            </Button>
          </div>
        ))}
        <div style={{ color: '#98a1af', fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
          被授权的跨团队用户会在其左侧「共享给我」列表看到此文档,权限变更即时生效;本团队成员无需单独授权。
        </div>
      </Modal>
    </div>
  );
}

function findNode(nodes: WrappedNode[], id: string): WrappedNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const f = findNode(n.children, id);
      if (f) return f;
    }
  }
  return null;
}
