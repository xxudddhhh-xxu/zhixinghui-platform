'use client';

import { useEffect, useMemo, useState } from 'react';
import { Segmented, Select, Tag, Tooltip } from 'antd';
import { FileTextOutlined, ShareAltOutlined, TeamOutlined } from '@ant-design/icons';
import { api } from '@/lib/request';
import DocumentTree from '@/components/DocumentTree';
import DocEditor from '@/components/DocEditor';
import type { DocNode, Team } from '@/types/api';

interface SharedDoc {
  id: string;
  title: string;
  teamId: string;
  teamName: string;
  myRole: string | null;
  updatedAt: string;
}

const ROLE_LABEL: Record<string, { text: string; color: string }> = {
  owner: { text: '所有者', color: 'purple' },
  admin: { text: '管理员', color: 'geekblue' },
  editor: { text: '编辑', color: 'blue' },
  viewer: { text: '只读', color: 'default' },
};

export default function DocumentsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocNode | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [shared, setShared] = useState<SharedDoc[]>([]);

  // 深链入口: /documents?teamId=xx&docId=yy(检索命中"打开原文档")
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get('teamId');
    const d = sp.get('docId');
    if (t) setTeamId(t);
    if (d) {
      setRevealId(d);
      setSelected({ id: d } as DocNode);
    }
  }, []);

  useEffect(() => {
    api.get<SharedDoc[]>('/documents/shared', { cacheMs: 5000 }).then(setShared).catch(() => {});
  }, []);

  useEffect(() => {
    api.get<Team[]>('/teams', { cacheMs: 5000 }).then((list) => {
      setTeams(list);
      setTeamId((prev) => prev ?? (list.length ? list[0].id : null));
    });
  }, []);

  const team = useMemo(() => teams.find((t) => t.id === teamId), [teams, teamId]);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)' }}>
      <aside style={{ width: 300, background: '#fff', borderRight: '1px solid #eceef2', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 12px 4px' }}>
          <Select
            value={teamId ?? undefined}
            onChange={(v) => {
              setTeamId(v);
              setSelected(null);
            }}
            style={{ width: '100%' }}
            placeholder="选择团队"
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
          />
          {team && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#8a92a2' }}>
              我的角色:
              <Tag
                color={ROLE_LABEL[team.myRole]?.color}
                style={{ marginLeft: 6 }}
              >
                {ROLE_LABEL[team.myRole]?.text ?? team.myRole}
              </Tag>
            </div>
          )}
        </div>
        {teamId && (
          <DocumentTree
            teamId={teamId}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            canManageTeam={team?.myRole === 'owner' || team?.myRole === 'admin'}
            canWriteTeam={team?.myRole === 'owner' || team?.myRole === 'admin' || team?.myRole === 'editor'}
            revealId={revealId}
          />
        )}

        {shared.length > 0 && (
          <div
            style={{
              borderTop: '1px solid #eceef2',
              padding: '10px 12px 12px',
              maxHeight: 200,
              overflow: 'auto',
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: 12, color: '#8a92a2', marginBottom: 6 }}>
              <ShareAltOutlined style={{ marginRight: 4 }} />
              共享给我的文档(跨团队授权)
            </div>
            {shared.map((s) => (
              <Tooltip key={s.id} title={`来自团队「${s.teamName}」 · ${s.myRole === 'editor' ? '可编辑' : '只读'}`}>
                <div
                  onClick={() => setSelected({ id: s.id } as DocNode)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    background: selected?.id === s.id ? '#eef3ff' : 'transparent',
                    fontSize: 13,
                  }}
                >
                  <TeamOutlined style={{ color: '#8a92a2', fontSize: 12 }} />
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.title}
                  </span>
                  <Tag style={{ marginInlineEnd: 0 }} color={s.myRole === 'editor' ? 'blue' : 'default'}>
                    {s.teamName}
                  </Tag>
                </div>
              </Tooltip>
            ))}
          </div>
        )}
      </aside>

      <main style={{ flex: 1, overflow: 'hidden' }}>
        {selected ? (
          <DocEditor key={selected.id} docId={selected.id} />
        ) : (
          <div style={{ padding: 48, color: '#8a92a2', textAlign: 'center', marginTop: 120 }}>
            <FileTextOutlined style={{ fontSize: 40, color: '#c3c9d6' }} />
            <p style={{ fontSize: 15 }}>选择左侧文档查看 / 编辑,文件夹点击展开加载子节点</p>
            <p style={{ fontSize: 13 }}>编辑器修改后 1.2s 自动保存;多人同时编辑会触发版本冲突提示</p>
          </div>
        )}
      </main>
    </div>
  );
}
