import type { App } from '../main.ts';

export class StatsView {
  private container: HTMLElement;
  private app: App;

  constructor(container: HTMLElement, app: App) {
    this.container = container;
    this.app = app;
  }

  render(): void {
    const w = this.app.engine.world;
    const s = w.stats;
    const onTimeRate = s.totalDelivered === 0 ? 0 : (s.byUrgency[1].onTime + s.byUrgency[2].onTime + s.byUrgency[3].onTime) / s.totalDelivered;
    const avgRatio = s.recentRatios.length === 0 ? 0 : s.recentRatios.reduce((a, b) => a + b, 0) / s.recentRatios.length;

    const rows = ([1, 2, 3] as const)
      .map((u) => {
        const b = s.byUrgency[u];
        const rate = b.delivered === 0 ? 0 : (b.onTime / b.delivered) * 100;
        const label = w.config.urgency[u].label;
        return `<tr>
          <td>${label}</td>
          <td>${b.created}</td>
          <td>${b.delivered}</td>
          <td>${b.onTime}</td>
          <td>
            <div class="bar wide"><div class="bar-fill ${rate >= 90 ? 'good' : rate >= 60 ? 'warn' : 'bad'}" style="width:${rate.toFixed(1)}%"></div></div>
            <span class="bar-num">${rate.toFixed(1)}%</span>
          </td>
        </tr>`;
      })
      .join('');

    const incidentsByType = new Map<string, number>();
    for (const inc of w.incidents) incidentsByType.set(inc.type, (incidentsByType.get(inc.type) ?? 0) + 1);
    const typeLabel: Record<string, string> = {
      rain_block: '暴雨断路',
      horse_sick: '马匹病倒',
      bandit: '劫道',
      reopen: '道路恢复',
    };
    const incidentRows = [...incidentsByType.entries()]
      .map(([type, count]) => `<tr><td>${typeLabel[type] ?? type}</td><td>${count}</td></tr>`)
      .join('');

    this.container.innerHTML = `
      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-num">${s.totalCreated}</div><div class="kpi-label">累计派单</div></div>
        <div class="kpi-card"><div class="kpi-num">${s.totalDelivered}</div><div class="kpi-label">已送达</div></div>
        <div class="kpi-card ${onTimeRate >= 0.9 ? '' : 'alarm'}"><div class="kpi-num">${(onTimeRate * 100).toFixed(1)}%</div><div class="kpi-label">总准时率</div></div>
        <div class="kpi-card"><div class="kpi-num">${s.totalOverdue}</div><div class="kpi-label">超时单数</div></div>
        <div class="kpi-card"><div class="kpi-num">${s.replans}</div><div class="kpi-label">重规划次数</div></div>
        <div class="kpi-card"><div class="kpi-num">${s.lastReplanMs.toFixed(2)}<small> ms</small></div><div class="kpi-label">上次全量重规划</div></div>
      </div>
      <div class="station-grid">
        <div class="card">
          <h3>分紧急等级准时率</h3>
          <table class="asset-table">
            <thead><tr><th>等级</th><th>派单</th><th>送达</th><th>准时</th><th>准时率</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="card">
          <h3>事故分布(最近 200 条)</h3>
          <table class="asset-table">
            <thead><tr><th>类型</th><th>次数</th></tr></thead>
            <tbody>${incidentRows || '<tr><td colspan="2" class="empty">暂无事故</td></tr>'}</tbody>
          </table>
          <h3 style="margin-top:18px">计划偏差</h3>
          <p class="muted">实际/计划用时比(近 50 单):<b>${avgRatio === 0 ? '—' : avgRatio.toFixed(3)}</b>${avgRatio > 1 ? ' · 路况导致普遍延误' : ' · 计划内到达'}</p>
        </div>
      </div>
      <div class="card">
        <h3>事故时间线</h3>
        <ul class="incident-list">
          ${w.incidents
            .slice(-12)
            .reverse()
            .map((i) => `<li><span class="tick-tag">tick ${i.tick}</span> ${i.message}</li>`)
            .join('') || '<li class="empty">暂无事故记录</li>'}
        </ul>
      </div>`;
  }
}
