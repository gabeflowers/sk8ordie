import { Game } from './core/Game';

declare global {
  interface Window {
    /** Só em dev: acesso à instância pelo console. */
    __game?: Game;
  }
}

const container = document.getElementById('app');
if (!container) throw new Error('#app não encontrado');

const game = new Game(container);
game.start();

if (import.meta.env.DEV) {
  window.__game = game;
  void import('./dev/DebugGui').then(({ setupDebugGui }) => setupDebugGui(game));
}
