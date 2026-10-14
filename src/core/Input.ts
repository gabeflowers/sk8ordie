import type { InputState } from '../sim/types';

const KEY = {
  forward: 'ArrowUp',
  brake: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  jump: 'Space',
  reset: 'KeyR',
} as const;

// teclas que não podem rolar a página
const PREVENT_DEFAULT = new Set<string>([KEY.forward, KEY.brake, KEY.left, KEY.right, KEY.jump]);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Teclado → InputState. As bordas (jump, reset) ficam guardadas até serem
 * consumidas, então não se perdem em frames sem passo de simulação.
 */
export class Input {
  private readonly held = new Set<string>();
  private jumpQueued = false;
  private resetQueued = false;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Estado para UM passo de simulação; consome a borda do jump. */
  consume(): InputState {
    const state: InputState = {
      forward: this.held.has(KEY.forward),
      brake: this.held.has(KEY.brake),
      left: this.held.has(KEY.left),
      right: this.held.has(KEY.right),
      jumpPressed: this.jumpQueued,
    };
    this.jumpQueued = false;
    return state;
  }

  consumeReset(): boolean {
    const r = this.resetQueued;
    this.resetQueued = false;
    return r;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isEditable(e.target)) return; // digitando na lil-gui
    if (e.ctrlKey || e.metaKey || e.altKey) return; // atalhos do navegador
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();

    this.held.add(e.code);
    if (e.repeat) return;
    if (e.code === KEY.jump) this.jumpQueued = true;
    if (e.code === KEY.reset) this.resetQueued = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clear();
  };

  private readonly clear = (): void => {
    this.held.clear();
    this.jumpQueued = false;
    this.resetQueued = false;
  };
}
