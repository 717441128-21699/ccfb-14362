import type { App } from '../main.ts';
import type { DocumentOrder, Road, Station } from '../engine/types.ts';

const URGENCY_COLOR: Record<number, string> = {
  1: '#e5484d',
  2: '#f5a623',
  3: '#7c9cb0',
};

const TERRAIN_LABEL: Record<string, string> = {
  plain: '平原',
  hills: '丘陵',
  mountain: '山地',
  desert: '荒漠',
  river_crossing: '渡津',
};

const WEATHER_ICON: Record<string, string> = {
  clear: '☀',
  cloudy: '☁',
  rain: '🌧',
  storm: '⛈',
  fog: '🌫',
};

export class MapView {
  private svg: SVGElement;
  private app: App;
  private selectedStation: number | null = null;

  constructor(svg: SVGElement, app: App) {
    this.svg = svg;
    this.app = app;
  }

  private el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  render(): void {
    const w = this.app.engine.world;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    // 道路
    for (const road of w.roads) {
      const a = w.stations[road.a];
      const b = w.stations[road.b];
      const blocked = road.blockedUntil > w.tick;
      const line = this.el('line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('class', blocked ? 'road blocked' : `road terrain-${road.terrain}`);
      line.addEventListener('click', () => this.onRoadClick(road));
      const title = this.el('title');
      title.textContent = `${a.name} → ${b.name} · ${road.distance}里 · ${TERRAIN_LABEL[road.terrain]} · ${
        blocked ? `断路至 ${road.blockedUntil}` : '畅通'
      }(点击封路/恢复)`;
      line.appendChild(title);
      this.svg.appendChild(line);

      if (blocked) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const tag = this.el('text');
        tag.setAttribute('x', String(midX));
        tag.setAttribute('y', String(midY - 6));
        tag.setAttribute('class', 'block-tag');
        tag.textContent = '✖断路';
        this.svg.appendChild(tag);
      }
    }

    // 在途公文(按当前程插值位置)
    for (const doc of w.documents) {
      if (doc.status === 'arrived') continue;
      const marker = this.docMarker(doc);
      if (marker) this.svg.appendChild(marker);
    }

    // 驿站
    for (const station of w.stations) {
      const g = this.el('g');
      g.setAttribute('class', `station ${this.selectedStation === station.id ? 'selected' : ''}`);
      g.addEventListener('click', () => {
        this.selectedStation = station.id;
        this.app.selectStation(station.id);
      });

      const circle = this.el('circle');
      circle.setAttribute('cx', String(station.x));
      circle.setAttribute('cy', String(station.y));
      circle.setAttribute('r', station.isCapital || station.isFrontier ? '9' : '6');
      circle.setAttribute('class', station.isCapital ? 'capital' : station.isFrontier ? 'frontier' : 'normal');
      g.appendChild(circle);

      const label = this.el('text');
      label.setAttribute('x', String(station.x + 10));
      label.setAttribute('y', String(station.y + 4));
      label.setAttribute('class', 'station-label');
      const prefix = station.isCapital ? '🏛' : station.isFrontier ? '🏯' : '';
      label.textContent = `${prefix}${station.name}`;
      g.appendChild(label);

      const weather = this.weatherOf(station);
      if (weather) {
        const wt = this.el('text');
        wt.setAttribute('x', String(station.x - 4));
        wt.setAttribute('y', String(station.y - 10));
        wt.setAttribute('class', 'weather-tag');
        wt.textContent = weather;
        g.appendChild(wt);
      }

      const title = this.el('title');
      title.textContent = `${station.name} · ${station.horseIds.length} 马 / ${station.courierIds.length} 驿卒(点击查看详情)`;
      g.appendChild(title);
      this.svg.appendChild(g);
    }

    // 图例
    this.drawLegend();
  }

  private weatherOf(station: Station): string {
    const w = this.app.engine.world;
    const edges = w.adjacency.get(station.id);
    if (!edges || edges.length === 0) return '';
    const road = w.roads[edges[0].roadId];
    return WEATHER_ICON[road.weather] ?? '';
  }

  private docMarker(doc: DocumentOrder): SVGElement | null {
    const w = this.app.engine.world;
    const active = doc.legs.find((l) => l.arrivedAt === null);
    if (!active) return null;
    const from = w.stations[active.fromStation];
    const to = w.stations[active.toStation];
    const t = this.app.engine.interpolateProgress(doc);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;

    const g = this.el('g');
    g.setAttribute('class', 'doc-marker');
    const c = this.el('circle');
    c.setAttribute('cx', String(x));
    c.setAttribute('y', String(y));
    c.setAttribute('r', '5');
    c.setAttribute('fill', URGENCY_COLOR[doc.urgency]);
    c.setAttribute('stroke', doc.status === 'overdue' ? '#fff' : 'none');
    c.setAttribute('stroke-width', doc.status === 'overdue' ? '2' : '0');
    g.appendChild(c);

    const title = this.el('title');
    const remain = Math.max(0, doc.deadline - w.tick);
    title.textContent = `${doc.code} · ${doc.urgency === 1 ? '一等加急' : doc.urgency === 2 ? '二等' : '常规'}
${from.name} → ${to.name} · 进度 ${(t * 100).toFixed(0)}%
距截止 ${remain.toFixed(0)} 分钟 · 重规划 ${doc.replanCount} 次
(点击触发劫道)`;
    g.appendChild(title);
    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.app.engine.banditAttack(doc.id);
      this.app.incidentFlash(`${doc.code} 遭遇劫道,当前程滞留`);
    });
    return g;
  }

  private onRoadClick(road: Road): void {
    const w = this.app.engine.world;
    if (road.blockedUntil > w.tick) {
      road.blockedUntil = -1;
      this.app.engine.replanAll();
      this.app.incidentFlash('驿路已手动恢复通行,并触发全量重规划');
    } else {
      this.app.engine.blockRoad(road.id);
    }
    this.render();
  }

  private drawLegend(): void {
    const legend = this.el('g');
    legend.setAttribute('class', 'legend');
    const items: Array<[string, string]> = [
      ['#e5484d', '一等加急'],
      ['#f5a623', '二等紧急'],
      ['#7c9cb0', '常规公文'],
    ];
    items.forEach(([color, text], i) => {
      const y = 24 + i * 22;
      const c = this.el('circle');
      c.setAttribute('cx', '24');
      c.setAttribute('cy', String(y));
      c.setAttribute('r', '5');
      c.setAttribute('fill', color);
      legend.appendChild(c);
      const t = this.el('text');
      t.setAttribute('x', '36');
      t.setAttribute('y', String(y + 4));
      t.setAttribute('class', 'legend-text');
      t.textContent = text;
      legend.appendChild(t);
    });
    const hint = this.el('text');
    hint.setAttribute('x', '24');
    hint.setAttribute('y', String(24 + items.length * 22 + 10));
    hint.setAttribute('class', 'legend-text hint');
    hint.textContent = '点驿站看详情 · 点道路封路 · 点公文劫道';
    legend.appendChild(hint);
    this.svg.appendChild(legend);
  }
}
