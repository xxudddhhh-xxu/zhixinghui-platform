'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Avatar, Button, Layout, Menu, Spin, theme } from 'antd';
import {
  BarChartOutlined,
  BookOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MessageOutlined,
  RobotOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth';

const { Sider, Content, Header } = Layout;

const menuItems = [
  { key: '/documents', icon: <FileTextOutlined />, label: <Link href="/documents">文档协作</Link> },
  { key: '/knowledge', icon: <BookOutlined />, label: <Link href="/knowledge">知识库</Link> },
  { key: '/chat', icon: <MessageOutlined />, label: <Link href="/chat">智能问答</Link> },
  { key: '/assistants', icon: <RobotOutlined />, label: <Link href="/assistants">智能助手</Link> },
  { key: '/dashboard', icon: <BarChartOutlined />, label: <Link href="/dashboard">运营大屏</Link> },
  { key: '/teams', icon: <TeamOutlined />, label: <Link href="/teams">团队管理</Link> },
];

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, loading, hydrate, logout } = useAuthStore();
  const { token: themeToken } = theme.useToken();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!loading && !token) router.replace('/login');
  }, [loading, token, router]);

  if (loading || !token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={208} theme="light" style={{ borderRight: '1px solid #eceef2' }}>
        <div style={{ padding: '18px 16px 10px', fontWeight: 800, fontSize: 16.5 }}>
          <span style={{ color: themeToken.colorPrimary }}>智星惠</span> 协作平台
        </div>
        <Menu items={menuItems} selectedKeys={[pathname]} mode="inline" style={{ borderInlineEnd: 'none' }} />
        <div style={{ position: 'absolute', bottom: 16, width: 208 - 32, padding: '0 16px' }}>
          <div style={{ fontSize: 11, color: '#9aa1af', textAlign: 'center' }}>
            Next.js · NestJS · Python RAG
          </div>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff', display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            paddingInline: 24, borderBottom: '1px solid #eceef2', height: 52, lineHeight: '52px',
          }}
        >
          <span style={{ marginRight: 10, fontSize: 13.5 }}>
            {user?.nickname || user?.username}
            {user?.globalRole === 'admin' && (
              <span style={{ color: '#fa8c16', marginLeft: 6, fontSize: 12 }}>平台管理员</span>
            )}
          </span>
          <Avatar style={{ background: themeToken.colorPrimary, marginRight: 12 }} size="small">
            {(user?.nickname || user?.username || '?').slice(0, 1)}
          </Avatar>
          <Button type="text" size="small" icon={<LogoutOutlined />} onClick={logout}>
            退出
          </Button>
        </Header>
        <Content style={{ overflow: 'auto' }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
