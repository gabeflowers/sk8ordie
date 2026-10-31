import type { VisualConfig } from '../config';
import type { Score, TrickAward } from '../sim/score';

type HudConfig = VisualConfig['hud'];

const STYLE = `
.sk8-hud { position: fixed; inset: 0; pointer-events: none; user-select: none;
  font-family: 'Barlow Condensed', system-ui, sans-serif; color: #e7e2d6; text-transform: uppercase; }
.sk8-hud .score { position: absolute; left: 14px; top: 10px; font-size: 15px; letter-spacing: 0.06em; line-height: 1.35;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
.sk8-hud .score b { font-size: 24px; color: #fff; }
.sk8-hud .line { position: absolute; right: 18px; bottom: 20px; display: flex; align-items: flex-end; gap: 12px;
  transition: opacity 0.3s; text-shadow: 0 2px 4px rgba(0,0,0,0.7); }
.sk8-hud .stack { text-align: right; line-height: 1.1; }
.sk8-hud .prev { font-size: 14px; color: rgba(231,226,214,0.7); letter-spacing: 0.04em; }
.sk8-hud .current { font-size: 26px; font-weight: 700; color: #fff; letter-spacing: 0.03em;
  text-shadow: 0 0 12px rgba(255,46,136,0.7), 0 2px 4px rgba(0,0,0,0.7); }
.sk8-hud .points { font-size: 22px; color: #fff; }
.sk8-hud .total { font-size: 14px; color: #ff9cc6; letter-spacing: 0.08em; }
.sk8-hud .ring { width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; flex: none;
  font-size: 18px; font-weight: 700; color: #fff; background: rgba(7,11,28,0.55);
  box-shadow: inset 0 0 0 3px #ff2e88, 0 0 14px rgba(255,46,136,0.6); }
.sk8-hud .result { position: absolute; right: 18px; bottom: 84px; font-size: 30px; font-weight: 700;
  text-shadow: 0 2px 4px rgba(0,0,0,0.7); transition: opacity 0.3s; }
.sk8-hud .result.banked { color: #ffcf7a; }
.sk8-hud .result.bail { color: #ff4d4d; }
.sk8-hud .balance { position: absolute; left: 50%; bottom: 18%; width: 220px; height: 10px; margin-left: -110px;
  border-radius: 5px; background: rgba(7,11,28,0.7); box-shadow: inset 0 0 0 1px rgba(255,46,136,0.6); transition: opacity 0.2s; }
.sk8-hud .balance i { position: absolute; top: -4px; width: 4px; height: 18px; margin-left: -2px; border-radius: 2px; background: #fff;
  box-shadow: 0 0 8px #ff2e88; }
`;

function fmt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}

function fmtMult(m: number): string {
  return `x${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`;
}

/**
 * HUD em DOM. Canto inferior direito: manobras anteriores da linha pequenas, a atual em destaque
 * (o grind conta ao vivo), pontos da linha, anel do multiplicador e total. Topo: total e recorde.
 */
export class Hud {
  private readonly root = document.createElement('div');
  private readonly scoreEl = document.createElement('div');
  private readonly lineEl = document.createElement('div');
  private readonly prevEl = document.createElement('div');
  private readonly currentEl = document.createElement('div');
  private readonly pointsEl = document.createElement('div');
  private readonly totalEl = document.createElement('div');
  private readonly ringEl = document.createElement('div');
  private readonly resultEl = document.createElement('div');
  private readonly balanceEl = document.createElement('div');
  private readonly needleEl = document.createElement('i');
  private seenLines = 0;
  private resultTimer = 0;
  private best = 0;

  constructor(
    container: HTMLElement,
    private readonly cfg: HudConfig,
  ) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.root.className = 'sk8-hud';
    this.scoreEl.className = 'score';
    this.lineEl.className = 'line';
    const stack = document.createElement('div');
    stack.className = 'stack';
    this.prevEl.className = 'prev';
    this.currentEl.className = 'current';
    this.pointsEl.className = 'points';
    this.totalEl.className = 'total';
    stack.append(this.prevEl, this.currentEl, this.pointsEl, this.totalEl);
    this.ringEl.className = 'ring';
    this.lineEl.append(stack, this.ringEl);
    this.resultEl.className = 'result';
    this.balanceEl.className = 'balance';
    this.balanceEl.append(this.needleEl);
    this.root.append(style, this.scoreEl, this.lineEl, this.resultEl, this.balanceEl);
    container.appendChild(this.root);
    try {
      this.best = Number(window.localStorage.getItem(cfg.bestKey)) || 0;
    } catch {
      this.best = 0;
    }
  }

  /** `live`: grind em andamento (pontos subindo); `balance`: equilíbrio do manual em −1..1. */
  update(score: Score, dt: number, live: TrickAward | null = null, balance: number | null = null): void {
    this.balanceEl.style.opacity = balance === null ? '0' : '1';
    if (balance !== null) this.needleEl.style.left = `${((Math.max(-1, Math.min(1, balance)) + 1) / 2) * 100}%`;

    if (score.lineCount !== this.seenLines) {
      this.seenLines = score.lineCount;
      const line = score.lastLine;
      if (line) {
        this.resultEl.textContent = line.banked ? `+${fmt(line.points)}` : 'Bail';
        this.resultEl.className = `result ${line.banked ? 'banked' : 'bail'}`;
        this.resultTimer = this.cfg.lineTime;
        if (line.banked && line.points > this.best) {
          this.best = line.points;
          try {
            window.localStorage.setItem(this.cfg.bestKey, String(this.best));
          } catch {
            // sem armazenamento: o recorde vale só nesta sessão
          }
        }
      }
    }
    this.resultTimer = Math.max(0, this.resultTimer - dt);
    this.resultEl.style.opacity = this.resultTimer > 0 ? '1' : '0';

    const tricks = live ? [...score.line, live] : score.line;
    const active = tricks.length > 0;
    this.lineEl.style.opacity = active ? '1' : '0';
    if (active) {
      const current = tricks[tricks.length - 1] as TrickAward;
      const prev = tricks.slice(-1 - this.cfg.stackSize, -1);
      this.prevEl.innerHTML = prev.map((t) => `<div>${t.name}</div>`).join('');
      this.currentEl.textContent = current.name;
      this.pointsEl.textContent = fmt(current.points);
      const base = score.lineBase + (live?.points ?? 0);
      this.totalEl.textContent = `Linha ${fmt(base * score.multiplier)}`;
      this.ringEl.textContent = fmtMult(score.multiplier);
    }

    this.scoreEl.innerHTML = `Pontos <b>${fmt(score.total)}</b><br>Recorde de linha ${fmt(Math.max(this.best, score.best))}`;
  }
}
