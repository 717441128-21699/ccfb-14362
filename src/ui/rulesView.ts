import type { App } from '../main.ts';
import type { RuleConfig, UrgencyLevel } from '../engine/types.ts';

type FieldSpec = {
  key: string;
  label: string;
  get: (c: RuleConfig) => number;
  set: (c: RuleConfig, v: number) => void;
  step: number;
  min: number;
  hint?: string;
};

const FIELDS: FieldSpec[] = [
  { key: 'baseSpeed', label: '基准速度(里/分钟)', get: (c) => c.baseSpeedPerMin, set: (c, v) => (c.baseSpeedPerMin = v), step: 0.01, min: 0.05 },
  { key: 'costPerLi', label: '每里体力消耗', get: (c) => c.stamina.costPerLi, set: (c, v) => (c.stamina.costPerLi = v), step: 0.01, min: 0.01 },
  { key: 'recover', label: '每分钟体力恢复', get: (c) => c.stamina.recoverPerMin, set: (c, v) => (c.stamina.recoverPerMin = v), step: 0.005, min: 0 },
  { key: 'lowPenalty', label: '低体力速度惩罚/点', get: (c) => c.stamina.lowStaminaSpeedPenalty, set: (c, v) => (c.stamina.lowStaminaSpeedPenalty = v), step: 0.001, min: 0 },
  { key: 'minStamina', label: '最低可用体力', get: (c) => c.stamina.minUsableStamina, set: (c, v) => (c.stamina.minUsableStamina = v), step: 1, min: 1 },
  { key: 'sickMin', label: '生病恢复分钟', get: (c) => c.stamina.sickRecoverMinutes, set: (c, v) => (c.stamina.sickRecoverMinutes = v), step: 60, min: 60 },
  { key: 'fatigueLeg', label: '每程疲劳增量', get: (c) => c.courier.fatiguePerLeg, set: (c, v) => (c.courier.fatiguePerLeg = v), step: 1, min: 0 },
  { key: 'fatigueRest', label: '每分钟疲劳恢复', get: (c) => c.courier.restPerMin, set: (c, v) => (c.courier.restPerMin = v), step: 0.005, min: 0 },
  { key: 'fatiguePenalty', label: '疲劳速度折损/点', get: (c) => c.courier.fatigueSpeedPenalty, set: (c, v) => (c.courier.fatigueSpeedPenalty = v), step: 0.0005, min: 0 },
  { key: 'rainProb', label: '断路概率/tick', get: (c) => c.incidents.rainProb, set: (c, v) => (c.incidents.rainProb = v), step: 0.002, min: 0 },
  { key: 'sickProb', label: '马病倒概率/tick', get: (c) => c.incidents.horseSickProb, set: (c, v) => (c.incidents.horseSickProb = v), step: 0.001, min: 0 },
  { key: 'banditProb', label: '劫道概率/tick', get: (c) => c.incidents.banditProb, set: (c, v) => (c.incidents.banditProb = v), step: 0.001, min: 0 },
  { key: 'spawnProb', label: '自动派单概率/tick', get: (c) => c.world.autoSpawnProb, set: (c, v) => (c.world.autoSpawnProb = v), step: 0.05, min: 0 },
];

export class RulesView {
  private container: HTMLElement;
  private app: App;

  constructor(container: HTMLElement, app: App) {
    this.container = container;
    this.app = app;
  }

  syncInputs(): void {
    this.render();
  }

  render(): void {
    const config = this.app.engine.world.config;
    const urgencyRows = ([1, 2, 3] as UrgencyLevel[])
      .map((u) => {
        const row = config.urgency[u];
        return `<tr>
          <td>${row.label}</td>
          <td><input type="number" data-urgency="${u}" data-field="deadline" value="${row.deadlineMinutes}" min="60" step="60"></td>
          <td><input type="number" data-urgency="${u}" data-field="speed" value="${row.speedMul}" min="0.1" step="0.05"></td>
          <td><input type="number" data-urgency="${u}" data-field="stamina" value="${row.staminaMul}" min="0.1" step="0.05"></td>
        </tr>`;
      })
      .join('');

    const fieldRows = FIELDS.map((f) => {
      const value = f.get(config);
      return `<tr>
        <td>${f.label}${f.hint ? `<br><small class="muted">${f.hint}</small>` : ''}</td>
        <td><input type="number" data-rule="${f.key}" value="${value}" min="${f.min}" step="${f.step}"></td>
      </tr>`;
    }).join('');

    const terrainRows = (Object.keys(config.terrain) as Array<keyof RuleConfig['terrain']>)
      .map((t) => {
        const row = config.terrain[t];
        return `<tr>
          <td>${row.label}</td>
          <td><input type="number" data-terrain="${t}" data-field="speed" value="${row.speedMul}" min="0.1" step="0.05"></td>
          <td><input type="number" data-terrain="${t}" data-field="stamina" value="${row.staminaMul}" min="0.1" step="0.05"></td>
        </tr>`;
      })
      .join('');

    this.container.innerHTML = `
      <div class="rules-intro">
        <p>修改任意数值后点击「应用并全量重规划」:规则即时写入运行世界,所有在途/待派公文按新公式重新计算,无需重启。</p>
      </div>
      <div class="card">
        <h3>紧急等级参数(一等限时默认 4320 分钟 = 3 个游戏日)</h3>
        <table class="asset-table">
          <thead><tr><th>等级</th><th>限时(分钟)</th><th>速度系数</th><th>体力系数</th></tr></thead>
          <tbody>${urgencyRows}</tbody>
        </table>
      </div>
      <div class="station-grid">
        <div class="card">
          <h3>体力 / 速度 / 事故规则</h3>
          <table class="asset-table"><tbody>${fieldRows}</tbody></table>
        </div>
        <div class="card">
          <h3>地形系数</h3>
          <table class="asset-table">
            <thead><tr><th>地形</th><th>速度系数</th><th>体力系数</th></tr></thead>
            <tbody>${terrainRows}</tbody>
          </table>
        </div>
      </div>
      <div class="rules-actions">
        <button id="btn-apply-rules" class="btn-primary">应用并全量重规划</button>
      </div>`;

    this.container.querySelector('#btn-apply-rules')!.addEventListener('click', () => this.apply());
  }

  private apply(): void {
    this.app.applyRules((config) => {
      // 紧急等级
      this.container.querySelectorAll<HTMLInputElement>('[data-urgency]').forEach((input) => {
        const u = Number(input.dataset.urgency) as UrgencyLevel;
        const field = input.dataset.field;
        const v = Number(input.value);
        if (field === 'deadline') config.urgency[u].deadlineMinutes = v;
        else if (field === 'speed') config.urgency[u].speedMul = v;
        else if (field === 'stamina') config.urgency[u].staminaMul = v;
      });
      // 标量规则
      this.container.querySelectorAll<HTMLInputElement>('[data-rule]').forEach((input) => {
        const spec = FIELDS.find((f) => f.key === input.dataset.rule)!;
        spec.set(config, Number(input.value));
      });
      // 地形
      this.container.querySelectorAll<HTMLInputElement>('[data-terrain]').forEach((input) => {
        const t = input.dataset.terrain as keyof RuleConfig['terrain'];
        const field = input.dataset.field;
        const v = Number(input.value);
        if (field === 'speed') config.terrain[t].speedMul = v;
        else if (field === 'stamina') config.terrain[t].staminaMul = v;
      });
    });
    this.app.incidentFlash('规则已热更新,全量重规划完成 —— 下一单立即按新规则走');
  }
}
