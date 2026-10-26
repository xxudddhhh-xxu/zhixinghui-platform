/** 轻量 Markdown 渲染: 标题/有序无序列表/代码块/表格/引用块/分隔线/加粗/斜体/行内码/链接,零依赖 */

import React from 'react';

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        parts.push(
          <a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer" style={{ color: '#3b5bff' }}>
            {link[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    } else if (token.startsWith('`')) {
      parts.push(
        <code key={key++} style={{ background: 'rgba(0,0,0,.06)', padding: '1px 5px', borderRadius: 4, fontSize: '0.9em' }}>
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;
const ORDERED = /^\s*\d+\./;

export function MarkdownView({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = content.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={key++}
          style={{
            background: '#0d1117',
            color: '#e6edf3',
            padding: '12px 14px',
            borderRadius: 8,
            overflowX: 'auto',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const size = [20, 17, 15.5, 14.5][level - 1];
      blocks.push(
        <div key={key++} style={{ fontWeight: 700, fontSize: size, margin: '10px 0 6px' }}>
          {renderInline(heading[2])}
        </div>,
      );
      i++;
      continue;
    }

    // 分隔线 --- / ***
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '10px 0' }} />);
      i++;
      continue;
    }

    // 引用块 >
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          style={{
            margin: '6px 0', padding: '6px 12px', borderLeft: '3px solid #3b5bff',
            background: '#f5f7ff', color: '#4b5563', borderRadius: '0 6px 6px 0', fontSize: 13.5,
          }}
        >
          {renderInline(quote.join('\n'))}
        </blockquote>,
      );
      continue;
    }

    // 列表: 连续同类型项为一组,有序项保留编号
    if (LIST_ITEM.test(line)) {
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        const isOrdered = ORDERED.test(lines[i]);
        const items: string[] = [];
        while (i < lines.length && LIST_ITEM.test(lines[i]) && ORDERED.test(lines[i]) === isOrdered) {
          items.push(lines[i].replace(LIST_ITEM, ''));
          i++;
        }
        const listItems = items.map((it, idx) => (
          <li key={idx} style={{ margin: '2px 0' }}>
            {renderInline(it)}
          </li>
        ));
        blocks.push(
          isOrdered ? (
            <ol key={key++} style={{ paddingLeft: 24, margin: '4px 0' }}>{listItems}</ol>
          ) : (
            <ul key={key++} style={{ paddingLeft: 22, margin: '4px 0' }}>{listItems}</ul>
          ),
        );
      }
      continue;
    }

    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim()))
        .map((l) =>
          l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()),
        );
      blocks.push(
        <table
          key={key++}
          style={{ borderCollapse: 'collapse', margin: '6px 0', fontSize: 13.5, width: '100%' }}
        >
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td
                    key={ci}
                    style={{
                      border: '1px solid #e5e7eb',
                      padding: '5px 10px',
                      background: ri === 0 ? '#f9fafb' : undefined,
                      fontWeight: ri === 0 ? 600 : 400,
                    }}
                  >
                    {renderInline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|\||>|\s*([-*]|\d+\.)\s|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} style={{ margin: '5px 0', lineHeight: 1.75 }}>
        {renderInline(para.join('\n'))}
      </p>,
    );
  }

  return <div className="md-view">{blocks}</div>;
}
