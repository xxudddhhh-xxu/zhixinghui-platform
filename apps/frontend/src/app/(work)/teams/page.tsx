'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { api } from '@/lib/request';
import type { Team } from '@/types/api';

const ROLE_LABEL: Record<string, { text: string; color: string }> = {
  owner: { text: '所有者', color: 'purple' },
  admin: { text: '管理员', color: 'geekblue' },
  editor: { text: '编辑', color: 'blue' },
  viewer: { text: '只读', color: 'default' },
};

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [membersModal, setMembersModal] = useState<{ team: Team } | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [addForm] = Form.useForm();
  const [form] = Form.useForm();

  const load = useCallback(() => {
    api.get<Team[]>('/teams', { cacheMs: 0 }).then(setTeams);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createTeam = async (values: any) => {
    try {
      await api.post('/teams', values);
      message.success('团队已创建');
      setCreateOpen(false);
      form.resetFields();
      load();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const openMembers = async (team: Team) => {
    setMembersModal({ team });
    setMembers(await api.get(`/teams/${team.id}/members`, { cacheMs: 0 }));
  };

  const addMember = async (values: any) => {
    try {
      await api.post(`/teams/${membersModal!.team.id}/members`, values);
      message.success('成员已添加');
      addForm.resetFields();
      openMembers(membersModal!.team);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <TeamOutlined style={{ marginRight: 8, color: '#3b5bff' }} />
          团队与权限
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建团队
        </Button>
      </div>

      <RowCards teams={teams} onManage={openMembers} />

      <Modal title="新建团队" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} okText="创建">
        <Form form={form} layout="vertical" onFinish={createTeam} requiredMark={false}>
          <Form.Item name="name" label="团队名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 市场团队" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`成员管理 · ${membersModal?.team.name ?? ''}`}
        open={!!membersModal}
        footer={null}
        onCancel={() => setMembersModal(null)}
        width={640}
      >
        <Form form={addForm} layout="inline" onFinish={addMember} style={{ marginBottom: 14 }}>
          <Form.Item name="username" rules={[{ required: true, message: '输入用户名' }]} style={{ flex: 1 }}>
            <Input placeholder="用户名(如 alice)" />
          </Form.Item>
          <Form.Item name="role" initialValue="viewer" rules={[{ required: true }]}>
            <Select
              style={{ width: 120 }}
              options={[
                { value: 'admin', label: '管理员' },
                { value: 'editor', label: '编辑' },
                { value: 'viewer', label: '只读' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">添加</Button>
        </Form>

        <Table
          size="small"
          rowKey="userId"
          dataSource={members}
          pagination={false}
          columns={[
            { title: '用户', render: (_, r: any) => `${r.nickname} (${r.username})` },
            {
              title: '角色',
              dataIndex: 'role',
              width: 150,
              render: (role: string, r: any) =>
                role === 'owner' ? (
                  <Tag color="purple">所有者</Tag>
                ) : (
                  <Select
                    size="small"
                    value={role}
                    style={{ width: 110 }}
                    onChange={async (v) => {
                      try {
                        await api.patch(`/teams/${membersModal!.team.id}/members/${r.userId}`, { role: v });
                        message.success('角色已更新(权限快照已失效重建)');
                        openMembers(membersModal!.team);
                      } catch (e: any) {
                        message.error(e.message);
                      }
                    }}
                    options={[
                      { value: 'admin', label: '管理员' },
                      { value: 'editor', label: '编辑' },
                      { value: 'viewer', label: '只读' },
                    ]}
                  />
                ),
            },
            {
              title: '操作',
              width: 90,
              render: (_, r: any) =>
                r.role !== 'owner' ? (
                  <Button
                    size="small"
                    danger
                    onClick={async () => {
                      await api.delete(`/teams/${membersModal!.team.id}/members/${r.userId}`);
                      message.success('已移除');
                      openMembers(membersModal!.team);
                    }}
                  >
                    移除
                  </Button>
                ) : null,
            },
          ]}
        />
      </Modal>
    </div>
  );
}

function RowCards({ teams, onManage }: { teams: Team[]; onManage: (t: Team) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
      {teams.map((t) => (
        <Card key={t.id} title={t.name} extra={<Tag color={ROLE_LABEL[t.myRole]?.color}>{ROLE_LABEL[t.myRole]?.text}</Tag>}>
          <Typography.Paragraph type="secondary" style={{ minHeight: 40 }} ellipsis={{ rows: 2 }}>
            {t.description || '暂无描述'}
          </Typography.Paragraph>
          <Space>
            <Button size="small" onClick={() => onManage(t)}>
              成员与权限
            </Button>
          </Space>
        </Card>
      ))}
    </div>
  );
}
