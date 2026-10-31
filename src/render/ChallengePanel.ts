import type { ChallengeDef, ChallengesConfig } from '../config';
import type { Challenges } from '../sim/challenges';

const STYLE = `
.sk8-challenges { position: fixed; left: 14px; top: 64px; pointer-events: none; user-select: none;
  font-family: 'Barlow Condensed', system-ui, sans-serif; text-transform: uppercase; color: #e7e2d6;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
.sk8-challenges .head { font-size: 13px; letter-spacing: 0.1em; color: #ff9cc6; }
.sk8-challenges .item { font-size: 15px; letter-spacing: 0.04em; line-height: 1.35; }
.sk8-challenges .item::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px;
  border-radius: 50%; box-shadow: inset 0 0 0 1.5px #ff2e88; }
.sk8-challenges .toast { margin-top: 8px; font-size: 22px; font-weight: 700; color: #ffcf7a; transition: opacity 0.3s; }
`;

/** Lista de desafios pendentes no canto superior esquerdo (abaixo dos pontos) e aviso quando um é concluído. */
export class ChallengePanel {
  private readonly root = document.createElement('div');
  private readonly headEl = document.createElement('div');
  private readonly listEl = document.createElement('div');
  private readonly toastEl = document.createElement('div');
  private toastTimer = 0;

  constructor(
    container: HTMLElement,
    private readonly cfg: ChallengesConfig,
  ) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.root.className = 'sk8-challenges';
    this.headEl.className = 'head';
    this.toastEl.className = 'toast';
    this.root.append(style, this.headEl, this.listEl, this.toastEl);
    container.appendChild(this.root);
  }

  update(challenges: Challenges, justDone: readonly ChallengeDef[], dt: number): void {
    if (justDone.length > 0) {
      this.toastEl.textContent = `Desafio: ${justDone.map((d) => d.title).join(' · ')}`;
      this.toastTimer = this.cfg.toastTime;
    }
    this.toastTimer = Math.max(0, this.toastTimer - dt);
    this.toastEl.style.opacity = this.toastTimer > 0 ? '1' : '0';

    const total = challenges.defs.length;
    this.headEl.textContent = `Desafios ${challenges.completed.size}/${total}`;
    const pending = challenges.pending.slice(0, this.cfg.visible);
    const html = pending.length > 0 ? pending.map((d) => `<div class="item">${d.title}</div>`).join('') : '<div class="item">Todos concluídos</div>';
    if (this.listEl.innerHTML !== html) this.listEl.innerHTML = html;
  }
}
