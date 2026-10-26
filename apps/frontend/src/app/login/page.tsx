'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Form, Input, message, Tabs } from 'antd';
import { api } from '@/lib/request';
import { useAuthStore } from '@/stores/auth';
import { passwordRule, usernameRule } from '@/lib/validators';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);

  const onLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: any }>('/auth/login', values);
      setAuth(res.token, res.user);
      message.success(`欢迎回来,${res.user.nickname}`);
      router.push('/documents');
    } catch (e: any) {
      message.error(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (values: any) => {
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: any }>('/auth/register', values);
      setAuth(res.token, res.user);
      message.success('注册成功,已自动登录');
      router.push('/documents');
    } catch (e: any) {
      message.error(e.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(140deg,#eef2ff,#f5f7fb 55%,#edf4ff)',
      }}
    >
      <Card style={{ width: 400, boxShadow: '0 8px 30px rgba(31,35,41,.08)' }} variant="borderless">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>智星惠协作平台</div>
          <div style={{ color: '#8a92a2', fontSize: 13, marginTop: 4 }}>知识管理与智能问答 · 企业内部版</div>
        </div>

        <Tabs
          centered
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form layout="vertical" onFinish={onLogin} requiredMark={false}>
                  <Form.Item name="username" rules={usernameRule}>
                    <Input placeholder="用户名" size="large" />
                  </Form.Item>
                  <Form.Item name="password" rules={passwordRule}>
                    <Input.Password placeholder="密码" size="large" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                    登 录
                  </Button>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form layout="vertical" onFinish={onRegister} requiredMark={false}>
                  <Form.Item name="username" rules={usernameRule}>
                    <Input placeholder="用户名(字母/数字/下划线)" size="large" />
                  </Form.Item>
                  <Form.Item name="nickname" rules={[{ required: true, message: '请输入昵称' }]}>
                    <Input placeholder="昵称" size="large" />
                  </Form.Item>
                  <Form.Item name="email" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
                    <Input placeholder="邮箱(选填)" size="large" />
                  </Form.Item>
                  <Form.Item name="password" rules={passwordRule}>
                    <Input.Password placeholder="密码(至少6位)" size="large" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block size="large" loading={loading}>
                    注册并登录
                  </Button>
                </Form>
              ),
            },
          ]}
        />

        <div style={{ color: '#98a1af', fontSize: 12, textAlign: 'center', lineHeight: 1.9 }}>
          演示账号:admin / admin123(平台管理员)<br />
          alice / Aa123456(研发团队)· bob / Bb123456(产品团队)
        </div>
      </Card>
    </main>
  );
}
