'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  message,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/request';
import type { AssistantItem, KnowledgeBaseItem, ModelItem } from '@/types/api';

export default function AssistantsPage() {
  const [list, setList] = useState<AssistantItem[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBaseItem[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [editing, setEditing] = useState<AssistantItem | 'new' | null>(null);
  const [form] = Form.useForm();

  const load = () => api.get<AssistantItem[]>('/assistants', { cacheMs: 0 }).then(setList);

  useEffect(() => {
    load();
    api.get<KnowledgeBaseItem[]>('/knowledge').then(setKbs);
    api.get<ModelItem[]>('/llm/models').then(setModels);
  }, []);

  const openForm = (item?: AssistantItem) => {
    setEditing(item ?? 'new');
    form.resetFields();
    if (item) {
      form.setFieldsValue({
        name: item.name,
        role: item.role,
        personality: item.personality,
        allowedTopics: item.allowedTopics,
        deniedTopics: item.deniedTopics,
        retrievalFirst: item.retrievalFirst,
        kbIds: item.kbIds || [],
        greeting: item.greeting,
        defaultModelId: item.defaultModelId,
      });
    } else {
      form.setFieldsValue({ retrievalFirst: true, kbIds: [] });
    }
  };

  const save = async (values: any) => {
    try {
      if (editing === 'new') {
        await api.post('/assistants', values);
        message.success('助手已创建');
      } else if (editing) {
        await api.patch(`/assistants/${editing.id}`, values);
        message.success('已保存');
      }
      setEditing(null);
      load();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const remove = async (item: AssistantItem) => {
    await api.delete(`/assistants/${item.id}`);
    message.success('已删除');
    load();
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <RobotOutlined style={{ marginRight: 8, color: '#3b5bff' }} />
          智能助手
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>
          新建助手
        </Button>
      </div>

      <Typography.Paragraph type="secondary" style={{ maxWidth: 720 }}>
        配置 AI 的角色定位、性格、可回答与不可回答的问题范围;开启「优先知识库检索」后,
        助手会先从关联知识库查找依据,没有答案时再由模型自由回答。
      </Typography.Paragraph>

      {list.length === 0 ? (
        <Empty description="暂无助手,点击右上角创建" style={{ marginTop: 70 }} />
      ) : (
        <Row gutter={[16, 16]}>
          {list.map((a) => (
            <Col key={a.id} xs={24} sm={12} lg={8}>
              <Card
                hoverable
                onClick={() => openForm(a)}
                actions={[
                  <EditOutlined key="edit" onClick={(e) => { e.stopPropagation(); openForm(a); }} />,
                  <Popconfirm key="del" title="确认删除该助手?" onConfirm={(e) => { e?.stopPropagation(); remove(a); }} onCancel={(e) => e?.stopPropagation()}>
                    <DeleteOutlined style={{ color: '#ff4d4f' }} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  avatar={<RobotOutlined style={{ fontSize: 26, color: '#3b5bff' }} />}
                  title={a.name}
                  description={<Tag color="geekblue">{a.role}</Tag>}
                />
                <div style={{ marginTop: 10, fontSize: 13, color: '#5c6470', lineHeight: 1.7 }}>
                  <div>
                    <UserOutlined style={{ marginRight: 6, color: '#8a92a2' }} />
                    性格:{a.personality || '—'}
                  </div>
                  <div style={{ wordBreak: 'break-all' }}>
                    <CheckCircleOutlined style={{ marginRight: 6, color: '#52c41a' }} />
                    可答:{a.allowedTopics || '—'}
                  </div>
                  <div style={{ wordBreak: 'break-all' }}>
                    <StopOutlined style={{ marginRight: 6, color: '#ff4d4f' }} />
                    拒答:{a.deniedTopics || '—'}
                  </div>
                  <div>
                    {a.retrievalFirst ? <Tag color="blue">优先知识库检索</Tag> : <Tag>模型直答</Tag>}
                    {a.defaultModelId && <Tag>{a.defaultModelId}</Tag>}
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Drawer
        title={editing === 'new' ? '新建智能助手' : '编辑智能助手'}
        open={!!editing}
        onClose={() => setEditing(null)}
        width={480}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 智能客服小惠" />
          </Form.Item>
          <Form.Item name="role" label="角色定位" rules={[{ required: true, message: '请输入角色' }]}>
            <Input placeholder="如: 企业内部智能客服 / 法务顾问" />
          </Form.Item>
          <Form.Item name="personality" label="性格与表达风格">
            <Input.TextArea rows={2} placeholder="如: 热情耐心、条理清晰,善用分点说明" />
          </Form.Item>
          <Form.Item name="allowedTopics" label="可以回答的问题范围">
            <Input.TextArea rows={2} placeholder="如: 账号权限、合同模板、差旅报销、产品使用问题" />
          </Form.Item>
          <Form.Item name="deniedTopics" label="不可以回答的问题范围">
            <Input.TextArea rows={2} placeholder="如: 薪酬机密、法律纠纷裁决" />
          </Form.Item>
          <Form.Item name="retrievalFirst" label="优先从知识库检索" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item name="kbIds" label="关联知识库">
            <Select mode="multiple" placeholder="选择该助手可引用的知识库" options={kbs.map((k) => ({ value: k.id, label: k.name }))} />
          </Form.Item>
          <Form.Item name="defaultModelId" label="默认模型">
            <Select allowClear placeholder="默认跟随会话所选模型" options={models.map((m) => ({ value: m.id, label: m.label }))} />
          </Form.Item>
          <Form.Item name="greeting" label="开场白">
            <Input.TextArea rows={2} placeholder="会话打开时展示的欢迎语" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            保存
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
