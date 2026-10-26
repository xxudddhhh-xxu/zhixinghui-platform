'use client';

import { useCallback, useEffect, useState } from 'react';
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
  Progress,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  BookOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ExportOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  InboxOutlined,
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/request';
import type { DocNode, KbDocItem, KnowledgeBaseItem, SearchHit, Team } from '@/types/api';

export default function KnowledgePage() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KnowledgeBaseItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const [activeKb, setActiveKb] = useState<KnowledgeBaseItem | null>(null);
  const [kbDocs, setKbDocs] = useState<KbDocItem[]>([]);
  const [teamDocs, setTeamDocs] = useState<DocNode[]>([]);
  const [docSelectOpen, setDocSelectOpen] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [hitDetail, setHitDetail] = useState<SearchHit | null>(null);

  const loadKbs = useCallback(async () => {
    setKbs(await api.get('/knowledge', { cacheMs: 0 }));
  }, []);

  useEffect(() => {
    loadKbs();
    api.get<Team[]>('/teams', { cacheMs: 10000 }).then(setTeams);
  }, [loadKbs]);

  const createKb = async (values: any) => {
    try {
      await api.post('/knowledge', values);
      message.success('知识库已创建');
      setCreateOpen(false);
      form.resetFields();
      loadKbs();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const openKb = async (kb: KnowledgeBaseItem) => {
    setActiveKb(kb);
    setHits(null);
    setKbDocs(await api.get(`/knowledge/${kb.id}/docs`, { cacheMs: 0 }));
  };

  const loadTeamDocs = async (kb: KnowledgeBaseItem) => {
    const docs = await api.get<DocNode[]>(`/documents?teamId=${kb.teamId}`, { cacheMs: 0 });
    setTeamDocs(docs.filter((d) => d.docType === 'doc'));
    setDocSelectOpen(true);
  };

  const ingestDoc = async (documentId: string) => {
    if (!activeKb) return;
    setIngesting(true);
    try {
      const res = await api.post(`/knowledge/${activeKb.id}/ingest-document`, { documentId });
      message.success(`入库完成,切片 ${res.chunkCount} 条`);
      setDocSelectOpen(false);
      openKb(activeKb);
      loadKbs();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setIngesting(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!activeKb) return;
    const fd = new FormData();
    fd.append('file', file);
    setIngesting(true);
    try {
      const res = await api.post(`/knowledge/${activeKb.id}/upload`, fd);
      message.success(`「${file.name}」入库完成,切片 ${res.chunkCount} 条`);
      openKb(activeKb);
      loadKbs();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setIngesting(false);
    }
  };

  const removeKbDoc = (rec: KbDocItem) => {
    Modal.confirm({
      title: `移除「${rec.sourceName}」?`,
      content: '该来源的向量与关键词索引将一并删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/knowledge/${activeKb!.id}/docs/${rec.id}`);
          message.success('已移除');
          openKb(activeKb!);
          loadKbs();
        } catch (e: any) {
          message.error(e.message);
        }
      },
    });
  };

  const runSearch = async () => {
    if (!query.trim() || !activeKb) return;
    setSearching(true);
    setHits(null);
    try {
      const results = await api.post<SearchHit[]>('/knowledge/search', {
        kbIds: [activeKb.id],
        query: query.trim(),
        topK: 6,
      });
      setHits(results);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <BookOutlined style={{ marginRight: 8, color: '#3b5bff' }} />
          知识库管理
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建知识库
        </Button>
      </div>

      {kbs.length === 0 ? (
        <Empty description="暂无知识库,点击右上角创建" style={{ marginTop: 80 }} />
      ) : (
        <Row gutter={[16, 16]}>
          {kbs.map((kb) => (
            <Col key={kb.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                hoverable
                onClick={() => openKb(kb)}
                styles={{ body: { padding: 18 } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <DatabaseOutlined style={{ fontSize: 22, color: '#3b5bff' }} />
                  <span style={{ fontWeight: 700, fontSize: 15.5 }}>{kb.name}</span>
                </div>
                <div style={{ color: '#7a8291', fontSize: 13, minHeight: 38, marginBottom: 10 }}>
                  {kb.description || '暂无描述'}
                </div>
                <Space size={16}>
                  <span style={{ fontSize: 13 }}>
                    <FileTextOutlined style={{ marginRight: 4, color: '#8a92a2' }} />
                    文档 {kb.docCount}
                  </span>
                  <span style={{ fontSize: 13 }}>
                    <DatabaseOutlined style={{ marginRight: 4, color: '#8a92a2' }} />
                    切片 {kb.chunkCount}
                  </span>
                </Space>
                <div style={{ marginTop: 6 }}>
                  <Tag>{teams.find((t) => t.id === kb.teamId)?.name ?? kb.teamId.slice(0, 8)}</Tag>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title="新建知识库"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={createKb} requiredMark={false}>
          <Form.Item name="teamId" label="所属团队" rules={[{ required: true, message: '请选择团队' }]}>
            <Select options={teams.map((t) => ({ value: t.id, label: t.name }))} placeholder="仅团队成员可创建" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 研发知识库" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="知识库用途说明(选填)" rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 知识库详情 */}
      <Drawer
        title={
          activeKb ? (
            <Space>
              <DatabaseOutlined style={{ color: '#3b5bff' }} />
              {activeKb.name}
              <Tag>{activeKb.chunkCount} 切片</Tag>
            </Space>
          ) : null
        }
        open={!!activeKb}
        onClose={() => setActiveKb(null)}
        width={640}
      >
        {activeKb && (
          <>
            <Space style={{ marginBottom: 14 }}>
              <Button icon={<FileSearchOutlined />} onClick={() => loadTeamDocs(activeKb)}>
                从团队文档导入
              </Button>
              <label>
                <input
                  type="file"
                  hidden
                  accept=".txt,.md,.pdf,.docx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadFile(f);
                    e.target.value = '';
                  }}
                />
                <Button icon={<UploadOutlined />} loading={ingesting}>
                  上传文件入库
                </Button>
              </label>
            </Space>

            <List
              size="small"
              bordered
              dataSource={kbDocs}
              locale={{ emptyText: <Empty description="暂无入库文档" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              renderItem={(rec) => (
                <List.Item
                  actions={[
                    <Tooltip title="移除" key="del">
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeKbDoc(rec)} />
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<InboxOutlined style={{ fontSize: 18, color: '#8a92a2' }} />}
                    title={rec.sourceName}
                    description={
                      <Space size={8}>
                        <span>{rec.chunkCount} 个切片</span>
                        <Tag
                          color={rec.status === 'ready' ? 'success' : rec.status === 'failed' ? 'error' : 'processing'}
                          style={{ marginInlineEnd: 0 }}
                        >
                          {rec.status === 'ready' ? '已就绪' : rec.status === 'failed' ? '失败' : '处理中'}
                        </Tag>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />

            <Typography.Title level={5} style={{ marginTop: 24 }}>
              <SearchOutlined style={{ marginRight: 6 }} />
              检索测试(向量 + BM25 混合召回)
            </Typography.Title>
            <Space.Compact style={{ width: '100%', marginBottom: 14 }}>
              <Input
                placeholder="输入问题,验证 RAG 召回效果…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onPressEnter={runSearch}
              />
              <Button type="primary" loading={searching} onClick={runSearch}>
                检索
              </Button>
            </Space.Compact>

            {hits && hits.length === 0 && <Empty description="未命中任何切片" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            {hits?.map((h, i) => (
              <Card
                key={h.id ?? i}
                size="small"
                hoverable
                onClick={() => setHitDetail(h)}
                style={{ marginBottom: 10, borderColor: '#dbe0ec', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Tag color="blue">{h.source || '知识库'}</Tag>
                  <Progress
                    percent={Math.round(Math.min(h.score, 1) * 100)}
                    size="small"
                    style={{ width: 120, margin: 0 }}
                    showInfo
                  />
                </div>
                <Typography.Paragraph
                  ellipsis={{ rows: 3 }}
                  style={{ marginBottom: 4, fontSize: 13, color: '#4a5160' }}
                >
                  {h.text}
                </Typography.Paragraph>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    <FileSearchOutlined style={{ marginRight: 4 }} />
                    点击卡片查看完整命中内容
                  </Typography.Text>
                  <Button size="small" type="link" icon={<FileSearchOutlined />} onClick={() => setHitDetail(h)}>
                    详情
                  </Button>
                </div>
              </Card>
            ))}
          </>
        )}
      </Drawer>

      {/* 命中片段详情 */}
      <Drawer
        title={`命中详情 · ${hitDetail?.source || '知识库'}`}
        open={!!hitDetail}
        onClose={() => setHitDetail(null)}
        width={520}
      >
        {hitDetail && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              {activeKb && <Tag>{activeKb.name}</Tag>}
              <Tag color="blue">{hitDetail.source || '知识库'}</Tag>
              <Tag color={hitDetail.score >= 0.5 ? 'green' : 'orange'}>
                相关度 {Math.round(Math.min(hitDetail.score, 1) * 100)}%
              </Tag>
            </Space>
            <Progress
              percent={Math.round(Math.min(hitDetail.score, 1) * 100)}
              size="small"
              style={{ maxWidth: 260, marginBottom: 16 }}
              showInfo={false}
            />
            <Typography.Paragraph
              copyable
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 13.5,
                lineHeight: 1.8,
                color: '#3c4353',
                background: '#f7f8fc',
                padding: 14,
                borderRadius: 8,
                marginBottom: 20,
              }}
            >
              {hitDetail.text}
            </Typography.Paragraph>
            {hitDetail.documentId ? (
              <Button
                type="primary"
                icon={<ExportOutlined />}
                onClick={() =>
                  router.push(`/documents?teamId=${hitDetail.teamId ?? ''}&docId=${hitDetail.documentId}`)
                }
              >
                打开原文档
              </Button>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                该片段来自直接上传的文件,未关联团队文档
              </Typography.Text>
            )}
          </>
        )}
      </Drawer>

      {/* 选择团队文档入库 */}
      <Modal
        title="选择要导入的团队文档"
        open={docSelectOpen}
        onCancel={() => setDocSelectOpen(false)}
        footer={null}
        width={520}
      >
        <List
          size="small"
          dataSource={teamDocs}
          locale={{ emptyText: '该团队暂无文档' }}
          renderItem={(d) => (
            <List.Item
              actions={[
                <Button key="in" size="small" type="primary" ghost loading={ingesting} onClick={() => ingestDoc(d.id)}>
                  入库
                </Button>,
              ]}
            >
              {d.title}
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
}
