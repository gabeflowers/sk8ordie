import type { ChallengeDef } from '../config';
import type { Score } from './score';

// Desafios. Puro: olha os contadores do Score a cada passo; quem chama persiste os concluídos.

export class Challenges {
  readonly completed: Set<string>;
  private seenTricks: number;
  private seenLines: number;

  constructor(
    readonly defs: readonly ChallengeDef[],
    score: Score,
    completed: Iterable<string> = [],
  ) {
    this.completed = new Set(completed);
    this.seenTricks = score.trickCount;
    this.seenLines = score.lineCount;
  }

  /** Desafios ainda abertos, na ordem do config. */
  get pending(): ChallengeDef[] {
    return this.defs.filter((d) => !this.completed.has(d.id));
  }

  /** Confere as manobras e linhas novas desde a última chamada; retorna os recém-concluídos. */
  update(score: Score): ChallengeDef[] {
    const done: ChallengeDef[] = [];
    const check = (pass: (d: ChallengeDef) => boolean): void => {
      for (const d of this.pending) {
        if (!pass(d)) continue;
        this.completed.add(d.id);
        done.push(d);
      }
    };

    if (score.trickCount !== this.seenTricks) {
      // várias manobras podem entrar no mesmo passo (sair do grind e pousar)
      const fresh = score.line.slice(-(score.trickCount - this.seenTricks));
      this.seenTricks = score.trickCount;
      check((d) => {
        switch (d.kind) {
          case 'trick':
            return fresh.some((t) => t.name.includes(d.target));
          case 'multiplier':
            return score.multiplier >= d.target;
          case 'combo':
            return score.line.length >= d.target;
          default:
            return false;
        }
      });
    }

    if (score.lineCount !== this.seenLines) {
      this.seenLines = score.lineCount;
      const line = score.lastLine;
      if (line?.banked) check((d) => d.kind === 'line' && line.points >= d.target);
    }
    return done;
  }
}
