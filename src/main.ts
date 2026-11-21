import { DEFAULT_CONFIG, cloneConfig } from './engine/config.ts';
import { generateWorld } from './engine/map.ts';
import { SimulationEngine } from './engine/simulation.ts';
import type { RuleConfig } from './engine/types.ts';
import { MapView } from './ui/mapView.ts';
import { StationView } from './ui/stationView.ts';
import { StatsView } from './ui/statsView.ts';
import { RulesView } from './ui/rulesView.ts';

type TabId = 'map' | 'station' | 'stats' | 'rules';

export class App {
  readonly engine: SimulationEngine;
  private mapView: MapView;
  private stationView: StationView;
  private statsView: StatsView;
  private rulesView: RulesView;
  private tab: TabId = 'map';
  private timer: number | null = null;
  private speedMs = 400;
  private seedInput: HTMLInputElement;
  private baselineConfig: RuleConfig;

  constructor() {
    const seed = Number(new URLSearchParams(location.search).get('seed')) || 20261122;
    const world = generateWorld(seed);
    this.engine = new SimulationEngine(world, seed);
    this.baselineConfig = cloneConfig(world.config);

    this.mapView = new MapView(document.querySelector<SVGElement>('#map-canvas')!, this);
    this.stationView = new StationView(document.querySelector<HTMLElement>('#station-panel')!, this);
    this.statsView = new StatsView(document.querySelector<HTMLElement>('#stats-panel')!, this);
    this.rulesView = new RulesView(document.querySelector<HTMLElement>('#rules-panel')!, this);
    this.seedInput = document.querySelector<HTMLInputElement>('#seed-input')!;
    this.seedInput.value = String(seed);

    this.bindControls();
    this.showTab('map');
    this.render();
  }

  private bindControls(): void {
    document.querySelectorAll<HTMLElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => this.showTab(btn.dataset.tab as TabId));
    });
    document.querySelector('#btn-play')!.addEventListener('click', () => this.togglePlay());
    document.querySelector('#btn-step')!.addEventListener('click', () => {
      this.pause();
      this.engine.tick();
      this.render();
    });
    document.querySelector('#btn-replan')!.addEventListener('click', () => {
      const ms = this.engine.replanAll();
      this.flash(`全量重规划完成,耗时 ${ms.toFixed(2)} ms`);
      this.render();
    });
    document.querySelector('#btn-spawn')!.addEventListener('click', () => {
      const w = this.engine.world;
      const capital = w.stations.find((s) => s.isCapital)!;
      const frontier = w.stations.find((s) => s.isFrontier)!;
      const urgency = (Number((document.querySelector('#spawn-urgency') as HTMLSelectElement).value) || 1) as 1 | 2 | 3;
      const doc = this.engine.spawn(capital.id, frontier.id, urgency);
      this.engine.replanDocument(doc);
      this.flash(`已派单 ${doc.code},限时 ${w.config.urgency[urgency].deadlineMinutes} 分钟`);
      this.render();
    });
    document.querySelector('#speed-select')!.addEventListener('change', (e) => {
      this.speedMs = Number((e.target as HTMLSelectElement).value);
      if (this.timer !== null) {
        this.pause();
        this.play();
      }
    });
    document.querySelector('#btn-regen')!.addEventListener('click', () => this.regenerate());
    document.querySelector('#btn-reset-rules')!.addEventListener('click', () => {
      this.engine.world.config = cloneConfig(this.baselineConfig);
      this.rulesView.syncInputs();
      this.engine.replanAll();
      this.flash('规则已恢复本世界基线,并已全量重规划');
      this.render();
    });
    document.querySelector('#btn-default-rules')!.addEventListener('click', () => {
      this.engine.world.config = cloneConfig(DEFAULT_CONFIG);
      this.rulesView.syncInputs();
      this.engine.replanAll();
      this.flash('规则已恢复出厂默认,并已全量重规划');
      this.render();
    });
  }

  private regenerate(): void {
    this.pause();
    const seed = Number(this.seedInput.value) || 1;
    location.search = `?seed=${seed}`;
  }

  private showTab(tab: TabId): void {
    this.tab = tab;
    document.querySelectorAll<HTMLElement>('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.panel !== tab);
    });
    this.render();
  }

  private togglePlay(): void {
    if (this.timer !== null) this.pause();
    else this.play();
  }

  private play(): void {
    document.querySelector<HTMLButtonElement>('#btn-play')!.textContent = '暂停';
    this.timer = window.setInterval(() => {
      this.engine.tick();
      this.render();
    }, this.speedMs);
  }

  private pause(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    document.querySelector<HTMLButtonElement>('#btn-play')!.textContent = '运行';
  }

  /** 规则面板修改后调用:热更新 + 全量重规划,下一单立即吃新规则 */
  applyRules(mutator: (config: RuleConfig) => void): void {
    mutator(this.engine.world.config);
    this.engine.replanAll();
    this.render();
  }

  /** 地图/驿站上的人工事故入口 */
  incidentFlash(message: string): void {
    this.flash(message);
    this.render();
  }

  private flash(message: string): void {
    const el = document.querySelector('#flash')!;
    el.textContent = message;
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  selectStation(stationId: number): void {
    this.stationView.select(stationId);
    this.showTab('station');
  }

  private render(): void {
    const w = this.engine.world;
    const days = Math.floor(w.tick / w.config.minutesPerDay) + 1;
    const hh = String(Math.floor((w.tick % w.config.minutesPerDay) / 60)).padStart(2, '0');
    const mm = String(w.tick % 60).padStart(2, '0');
    document.querySelector('#clock')!.textContent = `第 ${days} 日 ${hh}:${mm}(tick ${w.tick})`;
    document.querySelector('#kpi-documents')!.textContent = String(w.documents.length);
    document.querySelector('#kpi-intransit')!.textContent = String(w.stats.inTransit);
    document.querySelector('#kpi-queued')!.textContent = String(w.stats.queued);
    document.querySelector('#kpi-overdue')!.textContent = String(w.stats.totalOverdue);
    document.querySelector('#kpi-replan-ms')!.textContent = `${w.stats.lastReplanMs.toFixed(2)} ms`;

    if (this.tab === 'map') this.mapView.render();
    else if (this.tab === 'station') this.stationView.render();
    else if (this.tab === 'stats') this.statsView.render();
    else this.rulesView.render();
  }
}

new App();
