import { notFound } from 'next/navigation';
import Link from 'next/link';

/**
 * 公开文档页 —— ISR 增量静态渲染:
 * 首次请求生成静态页并缓存,之后 60 秒内复用,过期后台再生,
 * 显著改善公开文档首屏速度与 SEO。
 */
export const revalidate = 60;
export const dynamicParams = true;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001/api';

export async function generateStaticParams() {
  return [];
}

async function getDoc(id: string) {
  try {
    const res = await fetch(`${API_BASE}/documents/${id}/public`, {
      next: { revalidate },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.code === 0 ? json.data : null;
  } catch {
    return null;
  }
}

export default async function PublicDocPage({ params }: { params: { id: string } }) {
  const doc = await getDoc(params.id);
  if (!doc) notFound();

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ marginBottom: 20, fontSize: 13.5 }}>
        <Link href="/" style={{ color: '#3b5bff', textDecoration: 'none' }}>
          智星惠
        </Link>
        <span style={{ color: '#98a1af', margin: '0 8px' }}>/</span>
        <span style={{ color: '#5c6470' }}>公开文档(ISR · 每 60 秒再生)</span>
      </div>

      <article
        style={{
          background: '#fff',
          borderRadius: 14,
          padding: '36px 44px',
          boxShadow: '0 2px 14px rgba(31,35,41,.06)',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 6 }}>{doc.title}</h1>
        <div style={{ color: '#98a1af', fontSize: 13, marginBottom: 22 }}>
          更新于 {new Date(doc.updatedAt).toLocaleString('zh-CN')}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 2, fontSize: 15 }}>{doc.content}</div>
      </article>
    </main>
  );
}
