'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import {
  BookOutlined,
  CommentOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { api } from '@/lib/request';
import { useAuthStore } from '@/stores/auth';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface Overview {
  users: number;
  teams: number;
  docs: number;
  kbs: number;
  messages: number;
  assistants: number;
  avgLatencyMs: number;
}

/* ---------- 深色科技风主题 ---------- */
const C = {
  cyan: '#22d3ee',
  blue: '#4f7cff',
  purple: '#a78bfa',
  green: '#34d399',
  pink: '#f472b6',
  amber: '#fbbf24',
  text: '#e6ecff',
  sub: '#8ea0c9',
  faint: 'rgba(142,160,201,',
};

const neonPalette = [C.cyan, C.purple, C.green, C.amber, C.pink, C.blue];

const tooltip = {
  backgroundColor: 'rgba(7,13,31,.94)',
  borderColor: 'rgba(79,124,255,.45)',
  borderWidth: 1,
  textStyle: { color: C.text, fontSize: 12 },
  axisPointer: { lineStyle: { color: 'rgba(79,124,255,.5)' } },
};

const axisX = (data: string[]) => ({
  type: 'category' as const,
  data,
  axisLine: { lineStyle: { color: 'rgba(142,160,201,.25)' } },
  axisTick: { show: false },
  axisLabel: { color: C.sub, fontSize: 11 },
});

const axisY = {
  type: 'value' as const,
  minInterval: 1,
  axisLabel: { color: C.sub, fontSize: 11 },
  splitLine: { lineStyle: { color: 'rgba(142,160,201,.12)' } },
};

const grad = (from: string, to: string) => ({
  type: 'linear' as const,
  x: 0, y: 0, x2: 0, y2: 1,
  colorStops: [
    { offset: 0, color: from },
    { offset: 1, color: to },
  ],
});

/* ---------- 数字滚动动画 ---------- */
function useCountUp(target: number | undefined, duration = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target == null) return;
    // 不用 rAF: 离屏/后台 webview 中 rAF 可能永不触发
    const t0 = performance.now();
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / duration);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(id);
    }, 50);
    // 兜底: 即使 interval 被节流也保证落到终值
    const guard = setTimeout(() => {
      clearInterval(id);
      setV(target);
    }, duration + 400);
    return () => {
      clearInterval(id);
      clearTimeout(guard);
    };
  }, [target, duration]);
  return v;
}

function StatCard({ icon, title, value, color }: { icon: ReactNode; title: string; value?: number; color: string }) {
  const n = useCountUp(value);
  return (
    <div
      style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(160deg, rgba(20,32,68,.85), rgba(10,18,42,.9))',
        border: '1px solid rgba(79,124,255,.22)', borderRadius: 12,
        padding: '16px 18px', minHeight: 96,
        boxShadow: 'inset 0 0 24px rgba(79,124,255,.06)',
        transition: 'box-shadow .25s, transform .25s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `inset 0 0 24px rgba(79,124,255,.12), 0 0 22px ${color}33`;
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'inset 0 0 24px rgba(79,124,255,.06)';
        e.currentTarget.style.transform = 'none';
      }}
    >
      {/* 顶部霓虹描边 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.sub, fontSize: 12.5 }}>
        <span style={{ color, fontSize: 15, filter: `drop-shadow(0 0 6px ${color}88)` }}>{icon}</span>
        {title}
      </div>
      <div
        style={{
          fontSize: 30, fontWeight: 800, marginTop: 8, color: C.text,
          fontFamily: 'Consolas, Monaco, monospace', letterSpacing: 1,
          textShadow: `0 0 18px ${color}66`,
        }}
      >
        {value == null ? '—' : n.toLocaleString()}
      </div>
    </div>
  );
}

function Panel({ title, extra, children, style }: { title: string; extra?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'relative',
        background: 'linear-gradient(165deg, rgba(18,30,64,.78), rgba(8,15,36,.88))',
        border: '1px solid rgba(79,124,255,.2)', borderRadius: 12,
        boxShadow: 'inset 0 0 30px rgba(79,124,255,.05)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '13px 16px 10px',
          borderBottom: '1px solid rgba(79,124,255,.14)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14.5, color: C.text }}>
          <span
            style={{
              width: 3, height: 14, borderRadius: 2, display: 'inline-block',
              background: `linear-gradient(180deg, ${C.cyan}, ${C.blue})`, boxShadow: `0 0 8px ${C.cyan}aa`,
            }}
          />
          {title}
        </div>
        {extra}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
      {/* 四角科技感装饰 */}
      {[
        { top: -1, left: -1, borderTop: '2px solid', borderLeft: '2px solid' },
        { top: -1, right: -1, borderTop: '2px solid', borderRight: '2px solid' },
        { bottom: -1, left: -1, borderBottom: '2px solid', borderLeft: '2px solid' },
        { bottom: -1, right: -1, borderBottom: '2px solid', borderRight: '2px solid' },
      ].map((pos, i) => (
        <span
          key={i}
          style={{
            position: 'absolute', width: 12, height: 12, borderColor: `${C.cyan}cc`,
            borderRadius: 2, pointerEvents: 'none', ...pos,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/* ---------- 页面 ---------- */
export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trend, setTrend] = useState<{ day: string; userCnt: number; assistantCnt: number }[]>([]);
  const [teamDocs, setTeamDocs] = useState<{ team: string; docs: number }[]>([]);
  const [modelUsage, setModelUsage] = useState<{ model: string; count: number }[]>([]);
  const [topQueries, setTopQueries] = useState<{ query: string; count: number }[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [isFull, setIsFull] = useState(false);
  const isAdmin = useAuthStore((s) => s.user?.globalRole === 'admin');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFsChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // 全屏目标是大屏根容器:进入后隐藏侧边栏,只保留大屏内容
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      (rootRef.current ?? document.documentElement).requestFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    api.get<Overview>('/dashboard/overview').then(setOverview);
    api.get('/dashboard/messages-trend?days=14').then(setTrend);
    api.get('/dashboard/team-docs').then(setTeamDocs);
    api.get('/dashboard/model-usage').then(setModelUsage);
    api.get('/dashboard/top-queries').then(setTopQueries);
    if (isAdmin) {
      api.get('/audit/logs?page=1&pageSize=8').then((r) => setAuditLogs(r.items || []));
    }
    timerRef.current = setInterval(() => setNow(new Date()), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isAdmin]);

  const totalCalls = modelUsage.reduce((s, m) => s + m.count, 0);

  const trendOption = {
    tooltip: { trigger: 'axis' as const, ...tooltip },
    legend: { top: 0, right: 8, textStyle: { color: C.sub, fontSize: 12 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 40, right: 18, top: 34, bottom: 26 },
    xAxis: axisX(trend.map((t) => t.day)),
    yAxis: axisY,
    series: [
      {
        name: '提问数', type: 'line' as const, smooth: true, symbolSize: 6, symbol: 'circle' as const,
        data: trend.map((t) => t.userCnt),
        lineStyle: { width: 2.5, color: C.cyan, shadowColor: `${C.cyan}99`, shadowBlur: 12, shadowOffsetY: 4 },
        itemStyle: { color: C.cyan, borderColor: '#07101f', borderWidth: 2 },
        areaStyle: { color: grad('rgba(34,211,238,.32)', 'rgba(34,211,238,0)') },
      },
      {
        name: '回答数', type: 'line' as const, smooth: true, symbolSize: 6, symbol: 'circle' as const,
        data: trend.map((t) => t.assistantCnt),
        lineStyle: { width: 2.5, color: C.purple, shadowColor: `${C.purple}99`, shadowBlur: 12, shadowOffsetY: 4 },
        itemStyle: { color: C.purple, borderColor: '#07101f', borderWidth: 2 },
        areaStyle: { color: grad('rgba(167,139,250,.28)', 'rgba(167,139,250,0)') },
      },
    ],
  };

  const barOption = {
    tooltip: { ...tooltip },
    grid: { left: 40, right: 18, top: 20, bottom: 26 },
    xAxis: axisX(teamDocs.map((t) => t.team)),
    yAxis: axisY,
    series: [
      {
        type: 'bar' as const, data: teamDocs.map((t) => t.docs), barWidth: 34,
        itemStyle: { color: grad('#4f7cff', '#22d3ee'), borderRadius: [6, 6, 0, 0], shadowColor: 'rgba(79,124,255,.5)', shadowBlur: 10 },
        showBackground: true,
        backgroundStyle: { color: 'rgba(142,160,201,.07)', borderRadius: [6, 6, 0, 0] },
      },
    ],
  };

  const pieOption = {
    tooltip: { trigger: 'item' as const, ...tooltip },
    legend: { bottom: 0, textStyle: { color: C.sub, fontSize: 12 }, itemWidth: 12, itemHeight: 8 },
    title: {
      text: String(totalCalls), subtext: '总调用', left: '49.5%', top: '33%', textAlign: 'center',
      textStyle: { color: C.text, fontSize: 26, fontWeight: 800 },
      subtextStyle: { color: C.sub, fontSize: 12 },
    },
    series: [
      {
        type: 'pie' as const, radius: ['48%', '70%'], center: ['50%', '44%'],
        label: { color: C.sub, fontSize: 11, formatter: '{b} {c}' },
        itemStyle: { borderColor: '#081024', borderWidth: 2 },
        emphasis: { scaleSize: 6, itemStyle: { shadowBlur: 18, shadowColor: 'rgba(34,211,238,.55)' } },
        data: modelUsage.map((m, i) => ({
          name: m.model, value: m.count,
          itemStyle: { color: neonPalette[i % neonPalette.length] },
        })),
      },
    ],
  };

  const maxQuery = Math.max(1, ...topQueries.map((q) => q.count));
  const rankColor = [C.amber, 'rgba(203,213,225,.9)', 'rgba(217,119,87,.95)'];

  const stats = [
    { icon: <UserOutlined />, title: '用户总数', value: overview?.users, color: C.blue },
    { icon: <TeamOutlined />, title: '团队数', value: overview?.teams, color: C.purple },
    { icon: <FileTextOutlined />, title: '文档数', value: overview?.docs, color: C.green },
    { icon: <BookOutlined />, title: '知识库', value: overview?.kbs, color: C.amber },
    { icon: <CommentOutlined />, title: '累计提问', value: overview?.messages, color: C.pink },
    { icon: <RobotOutlined />, title: '智能助手', value: overview?.assistants, color: C.cyan },
  ];

  return (
    <div
      ref={rootRef}
      className={isFull ? 'zxhDashScroll' : undefined}
      style={{
        position: 'relative',
        // 全屏时该元素即全屏元素:固定高 100vh 并允许内部纵向滚动,否则内容超高被裁且无滚动条
        ...(isFull
          ? { height: '100vh', overflowY: 'auto' }
          : { minHeight: 'calc(100vh - 52px)' }),
        padding: '18px 20px 26px',
        background:
          'radial-gradient(1100px 480px at 72% -8%, rgba(79,124,255,.16), transparent 62%),' +
          'radial-gradient(900px 420px at 6% 108%, rgba(34,211,238,.1), transparent 60%),' +
          'linear-gradient(178deg, #060c1c 0%, #0a1430 100%)',
        color: C.text,
      }}
    >
      {/* 网格装饰层 */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: .5,
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(142,160,201,.05) 0 1px, transparent 1px 44px),' +
            'repeating-linear-gradient(90deg, rgba(142,160,201,.05) 0 1px, transparent 1px 44px)',
          maskImage: 'radial-gradient(ellipse at 50% 0%, black 30%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, black 30%, transparent 78%)',
        }}
      />

      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <DashboardOutlined style={{ fontSize: 22, color: C.cyan, filter: `drop-shadow(0 0 8px ${C.cyan}aa)` }} />
          <span
            style={{
              fontSize: 21, fontWeight: 800, letterSpacing: 2,
              background: `linear-gradient(92deg, #e6ecff 10%, ${C.cyan} 55%, ${C.blue} 90%)`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}
          >
            运营数据大屏
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.green, border: `1px solid ${C.green}55`, borderRadius: 99, padding: '2px 10px', background: `${C.green}12` }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: C.green, boxShadow: `0 0 8px ${C.green}`, animation: 'zxhPulse 1.6s infinite' }} />
            实时
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {overview && (
            <span style={{ fontSize: 12.5, color: C.sub }}>
              平均响应 <b style={{ color: C.cyan, fontFamily: 'Consolas, monospace' }}>{(overview.avgLatencyMs / 1000).toFixed(1)}s</b>
            </span>
          )}
          <span
            onClick={toggleFullscreen}
            title={isFull ? '退出全屏 (Esc)' : '全屏显示大屏'}
            style={{
              cursor: 'pointer', userSelect: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5,
              color: isFull ? C.cyan : C.sub,
              border: `1px solid ${isFull ? `${C.cyan}55` : 'rgba(142,160,201,.3)'}`,
              borderRadius: 8, padding: '4px 12px',
              background: isFull ? `${C.cyan}12` : 'rgba(142,160,201,.06)',
              transition: 'all .2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = C.cyan;
              e.currentTarget.style.borderColor = `${C.cyan}77`;
              e.currentTarget.style.boxShadow = `0 0 12px ${C.cyan}33`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = isFull ? C.cyan : C.sub;
              e.currentTarget.style.borderColor = isFull ? `${C.cyan}55` : 'rgba(142,160,201,.3)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {isFull ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            {isFull ? '退出全屏' : '全屏'}
          </span>
          <span style={{ fontSize: 13, color: C.sub }}>{now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</span>
          <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Consolas, Monaco, monospace', color: C.text, letterSpacing: 1, textShadow: `0 0 14px ${C.blue}77` }}>
            {now.toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        </div>
        <style>{`
@keyframes zxhPulse{0%,100%{opacity:1}50%{opacity:.25}}
.zxhDashScroll::-webkit-scrollbar{width:8px}
.zxhDashScroll::-webkit-scrollbar-thumb{background:rgba(142,160,201,.35);border-radius:8px}
.zxhDashScroll::-webkit-scrollbar-thumb:hover{background:rgba(142,160,201,.55)}
.zxhDashScroll::-webkit-scrollbar-track{background:transparent}
.zxhDashScroll{scrollbar-width:thin;scrollbar-color:rgba(142,160,201,.35) transparent}
`}</style>
      </div>

      {/* 指标卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, position: 'relative' }}>
        {stats.map((s) => (
          <StatCard key={s.title} {...s} />
        ))}
      </div>

      {/* 图表区 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 12, marginTop: 12, position: 'relative' }}>
        <div style={{ gridColumn: 'span 14' }}>
          <Panel title="近 14 天问答趋势">
            <ReactECharts option={trendOption} style={{ height: 272 }} />
          </Panel>
        </div>
        <div style={{ gridColumn: 'span 10' }}>
          <Panel title="模型调用量分布">
            <ReactECharts option={pieOption} style={{ height: 272 }} />
          </Panel>
        </div>
        <div style={{ gridColumn: 'span 14' }}>
          <Panel title="各团队文档数量">
            <ReactECharts option={barOption} style={{ height: 248 }} />
          </Panel>
        </div>
        <div style={{ gridColumn: 'span 10', display: 'flex', flexDirection: 'column' }}>
          <Panel title="高频提问 TOP" style={{ flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 220, justifyContent: topQueries.length ? 'flex-start' : 'center', alignItems: 'center' }}>
              {topQueries.length === 0 && <span style={{ color: C.sub, fontSize: 13 }}>暂无提问数据</span>}
              {topQueries.slice(0, 6).map((q, i) => (
                <div key={i} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 5 }}>
                    <span
                      style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
                        color: i < 3 ? '#07101f' : C.sub,
                        background: i < 3 ? rankColor[i] : `${C.faint}.12)`,
                        border: i < 3 ? 'none' : `1px solid ${C.faint}.3)`,
                        boxShadow: i < 3 ? `0 0 10px ${rankColor[i]}66` : 'none',
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{q.query}</span>
                    <span style={{ color: C.cyan, fontFamily: 'Consolas, monospace', fontSize: 12, flexShrink: 0 }}>{q.count} 次</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 99, background: `${C.faint}.1)`, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%', width: `${(q.count / maxQuery) * 100}%`, borderRadius: 99,
                        background: `linear-gradient(90deg, ${C.blue}, ${C.cyan})`,
                        boxShadow: `0 0 8px ${C.cyan}88`,
                        transition: 'width .8s cubic-bezier(.22,1,.36,1)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {isAdmin && (
          <div style={{ gridColumn: 'span 24' }}>
            <Panel
              title="安全审计(最近操作)"
              extra={<SafetyCertificateOutlined style={{ color: C.green, filter: `drop-shadow(0 0 6px ${C.green}88)` }} />}
            >
              <div style={{ fontSize: 12.5, overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '170px 110px 160px 1fr 130px', color: C.sub, padding: '6px 10px', borderBottom: `1px solid ${C.faint}.2)` }}>
                  {['时间', '用户', '动作', '资源', 'IP'].map((h) => <span key={h}>{h}</span>)}
                </div>
                {auditLogs.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '170px 110px 160px 1fr 130px', padding: '7px 10px',
                      borderBottom: `1px solid ${C.faint}.08)`, color: C.text,
                    }}
                  >
                    <span style={{ color: C.sub }}>{new Date(l.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    <span>{l.username}</span>
                    <span>
                      <span
                        style={{
                          fontSize: 11, padding: '1px 8px', borderRadius: 5,
                          color: l.action.includes('FAILED') ? '#ff8f8f' : l.action.includes('LOGIN') ? C.cyan : C.purple,
                          background: l.action.includes('FAILED') ? 'rgba(255,77,79,.12)' : l.action.includes('LOGIN') ? 'rgba(34,211,238,.1)' : 'rgba(167,139,250,.1)',
                          border: `1px solid ${l.action.includes('FAILED') ? 'rgba(255,77,79,.35)' : l.action.includes('LOGIN') ? 'rgba(34,211,238,.3)' : 'rgba(167,139,250,.3)'}`,
                        }}
                      >
                        {l.action}
                      </span>
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.sub }}>{l.resource}</span>
                    <span style={{ color: C.sub, fontFamily: 'Consolas, monospace' }}>{l.ip || '—'}</span>
                  </div>
                ))}
                {auditLogs.length === 0 && <div style={{ textAlign: 'center', color: C.sub, padding: 16 }}>暂无审计记录</div>}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
