/**
 * 轻量 Markdown → HTML 转换(零依赖)。
 * 语法子集与前端 MarkdownView 对齐:代码块/标题/分隔线/引用/
 * 有序无序列表/表格/粗体/斜体/行内代码/链接/段落。
 * 用于文档导出(.html / Word 兼容 .doc)。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
}

export function markdownToHtml(md: string): string {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const isTableSep = (l: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr/>');
      i++;
      continue;
    }

    // 引用块(连续 > 行合并)
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      out.push(`<ul>${buf.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+\.\s+/, ''));
      out.push(`<ol>${buf.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`);
      continue;
    }

    // 表格(表头 + |---| 分隔行)
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const cells = (l: string) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 段落(连续非空行合并)
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|[-*+]\s|\d+\.\s)/.test(lines[i])) {
      buf.push(lines[i++].trim());
    }
    if (buf.length) out.push(`<p>${buf.join('<br/>')}</p>`);
    else i++; // 兜底防死循环
  }
  return out.join('\n');
}

/** 导出用完整 HTML 文档(内嵌样式,可直接浏览器打开或 Word 打开) */
export function exportHtmlDocument(title: string, md: string, wordCompat = false): string {
  const body = markdownToHtml(md);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: ${wordCompat ? "'Microsoft YaHei', SimSun" : "-apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif"}; max-width: 860px; margin: 32px auto; padding: 0 24px; color: #1f2329; line-height: 1.75; }
  h1,h2,h3,h4 { border-bottom: 1px solid #eceef2; padding-bottom: 6px; }
  code { background: #f5f6f8; padding: 2px 5px; border-radius: 4px; font-family: Consolas, monospace; font-size: 13px; }
  pre { background: #f5f6f8; padding: 14px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 12px 0; padding: 8px 16px; border-left: 4px solid #d3d8e3; color: #5a6273; background: #f8f9fb; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th,td { border: 1px solid #d9dee8; padding: 8px 12px; text-align: left; }
  th { background: #f2f4f8; }
  a { color: #2f6fed; }
  hr { border: none; border-top: 1px solid #eceef2; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}
