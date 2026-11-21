import type { App } from '../main.ts';
import type { Courier, Horse } from '../engine/types.ts';

const HORSE_STATUS: Record<Horse['status'], string> = {
  available: '可用',
  assigned: '已派',
  riding: '在骑',
  sick: '病倒',
};

const COURIER_STATUS: Record<Courier['status'], string> = {
  available: '可用',
  assigned: '已派',
  riding: '在骑',
  resting: '休整',
};

export class StationView {
  private container: HTMLElement;
  private app: App;
  private selectedId: number | null = null;

  constructor(container: HTMLElement, app: App) {
    this.container = container;
    this.app = app;
  }

  select(stationId: number): void {
    this.selectedId = stationId;
  }

  render(): void {
    const w = this.app.engine.world;
    if (this.selectedId === null) this.selectedId = w.stations.find((s) => s.isCapital)?.id ?? 0;
    const station = w.stations[this.selectedId];
    if (!station) {
      this.container.innerHTML = '<p class="empty">无选中驿站</p>';
      return;
    }

    const options = w.stations
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === station.id ? 'selected' : ''}>${s.isCapital ? '🏛' : s.isFrontier ? '🏯' : ''}${s.name}</option>`,
      )
      .join('');

    const horses = station.horseIds.map((id) => w.horses[id]);
    const couriers = station.courierIds.map((id) => w.couriers[id]);
    const docsHere = w.documents.filter((d) => d.currentStation === station.id && d.status !== 'arrived');

    this.container.innerHTML = `
      <div class="station-head">
        <label>驿站
          <select id="station-select">${options}</select>
        </label>
        <div class="station-meta">
          <span class="pill">${horses.length} 匹马</span>
          <span class="pill">${couriers.length} 名驿卒</span>
          <span class="pill">${docsHere.length} 份公文滞留/经停</span>
        </div>
      </div>
      <div class="station-grid">
        <div class="card">
          <h3>马匹与体力</h3>
          <table class="asset-table">
            <thead><tr><th>马名</th><th>体力</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              ${horses
                .map(
                  (h) => `<tr class="${h.status}">
                    <td>${h.name}</td>
                    <td><div class="bar"><div class="bar-fill stamina" style="width:${h.stamina.toFixed(0)}%"></div></div><span class="bar-num">${h.stamina.toFixed(0)}</span></td>
                    <td><span class="status-tag ${h.status}">${HORSE_STATUS[h.status]}</span>${h.status === 'sick' ? `<br><small>恢复于 ${h.recoverAt}</small>` : ''}</td>
                    <td>${h.status !== 'sick' ? `<button class="btn-mini" data-sicken="${h.id}">弄病</button>` : '<span class="muted">养病中</span>'}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h3>驿卒与疲劳</h3>
          <table class="asset-table">
            <thead><tr><th>姓名</th><th>疲劳</th><th>状态</th></tr></thead>
            <tbody>
              ${couriers
                .map(
                  (c) => `<tr class="${c.status}">
                    <td>${c.name}</td>
                    <td><div class="bar"><div class="bar-fill fatigue" style="width:${c.fatigue.toFixed(0)}%"></div></div><span class="bar-num">${c.fatigue.toFixed(0)}</span></td>
                    <td><span class="status-tag ${c.status}">${COURIER_STATUS[c.status]}</span>${c.status === 'resting' ? `<br><small>可用於 ${c.availableAt}</small>` : ''}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3>经停/在站公文</h3>
        ${
          docsHere.length === 0
            ? '<p class="empty">当前无公文在站</p>'
            : `<table class="asset-table">
                <thead><tr><th>编号</th><th>等级</th><th>状态</th><th>下一站</th><th>距截止</th></tr></thead>
                <tbody>${docsHere
                  .map((d) => {
                    const next = d.legs.find((l) => l.arrivedAt === null);
                    const nextName = next ? w.stations[next.toStation].name : '—';
                    return `<tr>
                      <td>${d.code}</td>
                      <td>${d.urgency === 1 ? '一等加急' : d.urgency === 2 ? '二等' : '常规'}</td>
                      <td><span class="status-tag ${d.status}">${d.status}</span></td>
                      <td>${nextName}</td>
                      <td>${Math.max(0, d.deadline - w.tick).toFixed(0)} 分</td>
                    </tr>`;
                  })
                  .join('')}</tbody>
              </table>`
        }
      </div>`;

    this.container.querySelector('#station-select')!.addEventListener('change', (e) => {
      this.selectedId = Number((e.target as HTMLSelectElement).value);
      this.render();
    });
    this.container.querySelectorAll<HTMLButtonElement>('[data-sicken]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const horseId = Number(btn.dataset.sicken);
        this.app.engine.sickenHorse(horseId);
        this.app.incidentFlash(`${w.horses[horseId].name} 病倒,相关公文已自动重规划`);
      });
    });
  }
}
