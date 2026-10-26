import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import './globals.css';

export const metadata: Metadata = {
  title: '智星惠 · 在线团队文档协作平台',
  description:
    '面向企业内部员工的知识管理与智能问答平台:多团队文档协作、知识库 RAG 智能问答、流式智能客服、运营数据大屏与细粒度权限管控。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
