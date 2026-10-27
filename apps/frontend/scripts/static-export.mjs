/**
 * 静态导出构建编排:
 * 1. 临时移出 ISR 动态路由 docs/[id](revalidate 与 output:'export' 不兼容,
 *    其展示职责在导出模式下由 /docs/view 客户端页承担);
 * 2. 以 STATIC_EXPORT=1 执行 next build,产物输出到 out/;
 * 3. 无论成败都还原目录,保证本地工作区干净。
 */
import { execSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const isrDir = join(process.cwd(), 'src', 'app', 'docs', '[id]');
const backupDir = join(process.cwd(), '..', '..', '.isr-route-backup');

if (!existsSync(isrDir)) {
  if (existsSync(backupDir)) {
    console.error('[static-export] src/app/docs/[id] 不存在且存在备份,可能上次构建未还原,请手动检查');
    process.exit(1);
  }
  console.log('[static-export] 未发现 ISR 路由目录,跳过移出(可能已移出)');
} else {
  renameSync(isrDir, backupDir);
  console.log('[static-export] 已临时移出 ISR 路由: src/app/docs/[id]');
}

process.env.STATIC_EXPORT = '1';
process.env.NEXT_PUBLIC_STATIC_EXPORT = '1';
process.env.NEXT_PUBLIC_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || 'https://api.xudonghua.online/api';

try {
  execSync('npx next build', { stdio: 'inherit', env: process.env });
} finally {
  if (existsSync(backupDir)) {
    renameSync(backupDir, isrDir);
    console.log('[static-export] 已还原 ISR 路由目录');
  }
}
