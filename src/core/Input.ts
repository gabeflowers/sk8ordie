import type { SimConfig } from '../config';
import { TrickGesture } from '../sim/tricks/gesture';
import type { InputState } from '../sim/types';

const KEY = {
  forward: 'ArrowUp',
  brake: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  reset: 'KeyR',
} as const;

// teclas que não podem rolar a página nem disparar atalhos
const PREVENT_DEFAULT = new Set<string>([KEY.forward, KEY.brake, KEY.left, KEY.right, 'Space', 'KeyQ']);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Teclado → InputState. Setas movem; Espaço/Q agacham e dão o pop ao soltar (ollie/nollie);
 * A/D/S/W escolhem o flip (ver `TrickGesture`). As bordas ficam guardadas até serem
 * consumidas, então não se perdem em frames sem passo de simulação.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly gesture: TrickGesture;
  private resetQueued = false;

  constructor(
    tricks: SimConfig['tricks'],
    private readonly target: Window = window,
  ) {
    this.gesture = new TrickGesture(tricks);
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Estado para UM passo de simulação; consome o pop e o late flip. */
  consume(): InputState {
    const pop = this.gesture.consumePop();
    return {
      forward: this.held.has(KEY.forward),
      brake: this.held.has(KEY.brake),
      left: this.held.has(KEY.left),
      right: this.held.has(KEY.right),
      jumpPressed: pop !== null,
      crouch: this.gesture.crouching,
      pop: pop ?? undefined,
      lateTrick: this.gesture.consumeLate(),
      tap: this.gesture.consumeTap(),
      tilt: this.gesture.tilt,
      side: this.gesture.side,
      grab: this.held.has('KeyJ') ? 'front' : this.held.has('KeyL') ? 'back' : null,
    };
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
    this.gesture.keyDown(e.code, e.timeStamp / 1000);
    if (e.code === KEY.reset) this.resetQueued = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    this.gesture.keyUp(e.code, e.timeStamp / 1000);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clear();
  };

  private readonly clear = (): void => {
    this.held.clear();
    this.gesture.clear();
    this.resetQueued = false;
  };
}
