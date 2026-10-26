/**
 * 公开文档页链接:
 * - 常规模式(Next 服务端):ISR 动态路由 /docs/:id
 * - 静态导出模式(纯静态托管,无服务端渲染):改走查询参数路由 /docs/view?id=
 *   构建时由 NEXT_PUBLIC_STATIC_EXPORT 环境变量静态内联。
 */
export function docPublicHref(id: string): string {
  return process.env.NEXT_PUBLIC_STATIC_EXPORT === '1'
    ? `/docs/view?id=${id}`
    : `/docs/${id}`;
}
