'use client';

import Link from 'next/link';
import {
  BarChartOutlined,
  MessageOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

/** 平台首页(构建时静态生成 SSG) */
export default function Home() {
  const features: Array<{ icon: ReactNode; title: string; desc: string }> = [
    {
      icon: <SafetyCertificateOutlined />,
      title: '多团队权限隔离',
      desc: '团队 → 文档两级角色模型,Redis 权限快照 + 接口守卫双重鉴权,杜绝越权访问',
    },
    {
      icon: <MessageOutlined />,
      title: 'RAG 智能问答',
      desc: '向量 + BM25 混合检索与重排序,SSE 流式打字机输出,私有文档问答更准更快',
    },
    {
      icon: <RobotOutlined />,
      title: '智能助手',
      desc: '自由配置 AI 角色、性格、可答/拒答范围,优先知识库检索、无答案再 AI 兜底',
    },
    {
      icon: <ToolOutlined />,
      title: '工具调用',
      desc: '模型可调用知识检索、精确计算、时间查询等工具,多模型(GLM / JPT)一键切换',
    },
    {
      icon: <ThunderboltOutlined />,
      title: '性能优化',
      desc: 'SSR / SSG / ISR 多渲染策略,文档树懒加载,编辑器防抖自动保存,请求缓存去重',
    },
    {
      icon: <BarChartOutlined />,
      title: '运营数据大屏',
      desc: 'ECharts 呈现问答趋势、团队文档分布、模型用量与高频问题,安全审计全程留痕',
    },
  ];

  return (
    <main style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#eef2ff 0%,#f8fafc 40%,#eef6ff 100%)' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 48px' }}>
        <div style={{ fontWeight: 800, fontSize: 20 }}>智星惠 · 文档协作与智能问答平台</div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', fontSize: 15 }}>
          <a href="#features" style={{ color: '#3b5bff', textDecoration: 'none' }}>核心能力</a>
          <Link href="/login" style={{ color: '#3b5bff', textDecoration: 'none', fontWeight: 600 }}>
            进入平台 →
          </Link>
        </div>
      </nav>

      <section style={{ textAlign: 'center', padding: '72px 24px 48px' }}>
        <h1 style={{ fontSize: 44, margin: '0 0 16px', letterSpacing: 1 }}>
          让企业知识 <span style={{ color: '#3b5bff' }}>一问即答</span>
        </h1>
        <p style={{ fontSize: 18, color: '#5c6470', maxWidth: 680, margin: '0 auto 32px', lineHeight: 1.8 }}>
          整合合同、流程规范、业务手册等内部文档,提供多团队文档协作、知识库管理、
          RAG 智能问答与流式智能客服,替代重复性人工答疑,显著降低咨询成本。
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Link
            href="/login"
            style={{
              background: '#3b5bff', color: '#fff', padding: '12px 36px', borderRadius: 10,
              textDecoration: 'none', fontSize: 16, fontWeight: 600, boxShadow: '0 6px 20px rgba(59,91,255,.35)',
            }}
          >
            立即体验
          </Link>
          <a
            href="#features"
            style={{
              border: '1px solid #c9d2f8', color: '#3b5bff', padding: '12px 36px', borderRadius: 10,
              textDecoration: 'none', fontSize: 16, fontWeight: 600,
            }}
          >
            了解更多
          </a>
        </div>
        <p style={{ color: '#98a1af', fontSize: 13, marginTop: 28 }}>
          演示账号:admin / admin123 · alice / Aa123456 · bob / Bb123456
        </p>
      </section>

      <section id="features" style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 24px 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {features.map((f) => (
            <div
              key={f.title}
              style={{
                background: '#fff', borderRadius: 14, padding: '22px 24px',
                boxShadow: '0 2px 12px rgba(31,35,41,.06)', border: '1px solid #eef0f5',
              }}
            >
              <div
                style={{
                  width: 42, height: 42, borderRadius: 10, background: '#eef2ff', color: '#3b5bff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                }}
              >
                {f.icon}
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, margin: '12px 0 6px' }}>{f.title}</div>
              <div style={{ color: '#5c6470', fontSize: 13.5, lineHeight: 1.7 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ textAlign: 'center', color: '#98a1af', padding: '24px 0 40px', fontSize: 13 }}>
        智星惠在线团队文档协作平台 · Next.js + NestJS + Python RAG · PostgreSQL / Redis / Qdrant
      </footer>
    </main>
  );
}
