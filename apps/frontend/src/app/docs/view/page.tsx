'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE } from '@/lib/request';

/**
 * 公开文档页(纯客户端版,供静态导出托管使用):
 * 常规模式下该页面由 /docs/[id] 的 ISR 服务端渲染承担;
 * 静态导出后无服务端,这里在浏览器端拉取并渲染同一接口。
 * URL 形态:/docs/view?id=xxx(托管层 _redirects 会把 /docs/xxx 重写到本页)
 */

interface PublicDoc {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

function DocView() {
  const searchParams = useSearchParams();
  const [doc, setDoc] = useState<PublicDoc | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  // 静态托管重写(/docs/xxx → 本页)时地址栏不携带查询参数,从路径兜底解析
  const id =
    searchParams.get('id') ||
    (typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '');

  useEffect(() => {
    if (!id) {
      setState('missing');
      return;
    }
    let alive = true;
    fetch(`${API_BASE}/documents/${id}/public`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!alive) return;
        if (json.code === 0 && json.data) {
          setDoc(json.data);
          setState('ok');
        } else {
          setState('missing');
        }
      })
      .catch(() => alive && setState('missing'));
    return () => {
      alive = false;
    };
  }, [id]);

  if (state === 'loading') {
    return (
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 20px', color: '#98a1af' }}>
        正在加载文档…
      </main>
    );
  }

  if (state === 'missing') {
    return (
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 20px', color: '#5c6470' }}>
        <p>文档不存在、未公开或已下线。</p>
        <Link href="/" style={{ color: '#3b5bff', textDecoration: 'none' }}>
          返回首页
        </Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ marginBottom: 20, fontSize: 13.5 }}>
        <Link href="/" style={{ color: '#3b5bff', textDecoration: 'none' }}>
          智星惠
        </Link>
        <span style={{ color: '#98a1af', margin: '0 8px' }}>/</span>
        <span style={{ color: '#5c6470' }}>公开文档</span>
      </div>

      <article
        style={{
          background: '#fff',
          borderRadius: 14,
          padding: '36px 44px',
          boxShadow: '0 2px 14px rgba(31,35,41,.06)',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 6 }}>{doc!.title}</h1>
        <div style={{ color: '#98a1af', fontSize: 13, marginBottom: 22 }}>
          更新于 {new Date(doc!.updatedAt).toLocaleString('zh-CN')}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 2, fontSize: 15 }}>{doc!.content}</div>
      </article>
    </main>
  );
}

export default function PublicDocViewPage() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 20px', color: '#98a1af' }}>
          正在加载文档…
        </main>
      }
    >
      <DocView />
    </Suspense>
  );
}
