import { LastGlobalAction, WOR } from './wor-match.entity';

export interface MembroTeam {
  alunoId: string;
  nome: string;
}

/** Cores das fortalezas (temática épica). Até 10 equipes (turmas grandes). */
export const CORES_TEAM = [
  '#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
];

/**
 * Estado LOCAL de uma equipe (`matches/{id}/teams/{teamId}`) — os dados de
 * mudança rápida. O celular do aluno escuta APENAS o próprio doc de equipe:
 * quando sofre dano/cura, o listener dispara barato (tela vermelha, etc.).
 */
export class WorTeamEntity {
  id: string;
  matchId: string;
  nome: string;
  cor: string;
  hp: number = WOR.HP_INICIAL;
  /** Castelo destruído → vira Horda Bárbara (só pode Invasão). */
  isHorde = false;
  /** Pontos de combate acumulados (dano causado + bônus). Desempata e vira XP. */
  pontos = 0;
  membros: MembroTeam[] = [];
  /**
   * Cópia do último Action Card (fan-out). Redundante com a raiz de propósito:
   * o aluno só escuta este doc, e é por aqui que a narração global o alcança.
   */
  lastGlobalAction?: LastGlobalAction | null;

  constructor(partial: Partial<WorTeamEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Aplica dano (não passa de 0). Retorna se o castelo caiu agora. */
  aplicarDano(qtd: number): boolean {
    this.hp = Math.max(0, this.hp - qtd);
    if (this.hp === 0 && !this.isHorde) {
      this.isHorde = true;
      return true;
    }
    return false;
  }

  /** Cura respeitando o teto de HP inicial. */
  curar(qtd: number): void {
    this.hp = Math.min(WOR.HP_INICIAL, this.hp + qtd);
  }
}
