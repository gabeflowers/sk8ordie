import type { VisualConfig } from '../config';
import type { Score } from '../sim/score';

type HudConfig = VisualConfig['hud'];

const STYLE = `
.sk8-hud { position: fixed; inset: 0; pointer-events: none; user-select: none;
  font-family: 'Barlow Condensed', system-ui, sans-serif; color: #e7e2d6; text-transform: uppercase; }
.sk8-hud .score { position: absolute; left: 14px; top: 10px; font-size: 15px; letter-spacing: 0.06em; line-height: 1.35;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
.sk8-hud .score b { font-size: 24px; color: #fff; }
.sk8-hud .center { position: absolute; left: 0; right: 0; top: 14%; text-align: center; }
.sk8-hud .trick { font-size: 34px; font-weight: 700; letter-spacing: 0.03em; color: #fff;
  text-shadow: 0 0 12px rgba(255,46,136,0.75), 0 2px 4px rgba(0,0,0,0.7); transition: opacity 0.25s; }
.sk8-hud .trick small { display: block; font-size: 18px; color: #ff9cc6; }
.sk8-hud .line { margin-top: 4px; font-size: 22px; color: #ff2e88; text-shadow: 0 2px 4px rgba(0,0,0,0.7); }
.sk8-hud .result { margin-top: 6px; font-size: 28px; font-weight: 700; transition: opacity 0.3s; }
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

/** HUD em DOM: manobra pousada, linha × multiplicador, resultado da linha, total e recorde. */
export class Hud {
  private readonly root = document.createElement('div');
  private readonly scoreEl = document.createElement('div');
  private readonly trickEl = document.createElement('div');
  private readonly lineEl = document.createElement('div');
  private readonly resultEl = document.createElement('div');
  private readonly balanceEl = document.createElement('div');
  private readonly needleEl = document.createElement('i');
  private seenTricks = 0;
  private seenLines = 0;
  private trickTimer = 0;
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
    const center = document.createElement('div');
    center.className = 'center';
    this.trickEl.className = 'trick';
    this.lineEl.className = 'line';
    this.resultEl.className = 'result';
    center.append(this.trickEl, this.lineEl, this.resultEl);
    this.balanceEl.className = 'balance';
    this.balanceEl.append(this.needleEl);
    this.root.append(style, this.scoreEl, center, this.balanceEl);
    container.appendChild(this.root);
    try {
      this.best = Number(window.localStorage.getItem(cfg.bestKey)) || 0;
    } catch {
      this.best = 0;
    }
  }

  /** `balance`: equilíbrio do manual em −1..1 (null fora do manual). */
  update(score: Score, dt: number, balance: number | null = null): void {
    this.balanceEl.style.opacity = balance === null ? '0' : '1';
    if (balance !== null) this.needleEl.style.left = `${((Math.max(-1, Math.min(1, balance)) + 1) / 2) * 100}%`;

    if (score.trickCount !== this.seenTricks) {
      this.seenTricks = score.trickCount;
      const t = score.lastTrick;
      if (t) {
        this.trickEl.innerHTML = '';
        this.trickEl.append(t.name);
        const pts = document.createElement('small');
        pts.textContent = `+${fmt(t.points)}`;
        this.trickEl.append(pts);
        this.trickTimer = this.cfg.trickTime;
      }
    }

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

    this.trickTimer = Math.max(0, this.trickTimer - dt);
    this.resultTimer = Math.max(0, this.resultTimer - dt);
    this.trickEl.style.opacity = this.trickTimer > 0 ? '1' : '0';
    this.resultEl.style.opacity = this.resultTimer > 0 ? '1' : '0';

    this.lineEl.textContent = score.line.length > 0 ? `${fmt(score.lineBase)} × ${score.multiplier}` : '';
    this.scoreEl.innerHTML = `Pontos <b>${fmt(score.total)}</b><br>Recorde de linha ${fmt(Math.max(this.best, score.best))}`;
  }
}
