/** Constantes de balanceamento (v1). Centralizadas para tuning posterior. */
export const WOR = {
  HP_INICIAL: 100,
  DANO_SISTEMA: 10,
  DANO_ATAQUE: 15,
  DANO_CRITICO: 30,
  CURA_MASSIVA: 40,
  MAX_CARTAS: 3,
} as const;

export type StatusMatch = 'LOBBY' | 'EM_ANDAMENTO' | 'ENCERRADO';

export interface InscritoWor {
  alunoId: string;
  nome: string;
}

/**
 * Estado GLOBAL (raiz `matches/{id}`) de uma batalha do Tichr Wor. É lido pelo
 * cliente (professor e alunos), então **NÃO** guarda o segredo: a palavra e as
 * dicas completas ficam em `wor_jogos` (server-only). Aqui vai só a máscara, as
 * cartas já reveladas e o controle de turno/onda. Escrita só pelo backend.
 */
export class WorMatchEntity {
  id: string;
  jogoId: string;
  professorId: string;
  turmaId: string;
  nome: string;

  status: StatusMatch = 'LOBBY';
  criadaEm?: string | null;

  /** Índice da onda (palavra) atual no baralho e total de ondas. */
  ondaIndex = 0;
  totalOndas = 0;

  /** Máscara da palavra: cada item é a letra revelada, '_' (oculta) ou ' ' (espaço). */
  mascara: string[] = [];
  /** Letras já tentadas nesta onda (normalizadas, maiúsculas sem acento). */
  letrasTentadas: string[] = [];
  /** Cartas de dica já visíveis no telão (Carta 1 sempre; 2 e 3 por sacrifício). */
  cartasVisiveis: string[] = [];
  /** Quantas cartas existem nesta palavra (para saber se ainda há o que comprar). */
  totalCartas = 0;

  /** Turno e fluxo do dilema. */
  turnoEquipeId?: string | null;
  ordemEquipes: string[] = [];
  /** Após um acerto de letra, a equipe deve escolher o Dilema Tático. */
  aguardandoDilema = false;
  dilemaEquipeId?: string | null;

  inscritos: InscritoWor[] = [];
  vencedorEquipeId?: string | null;

  constructor(partial: Partial<WorMatchEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Normaliza uma letra para comparação: maiúscula, sem acento. */
  static normalizar(letra: string): string {
    return letra
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase();
  }

  /**
   * Máscara da palavra dado o conjunto de letras reveladas (normalizadas).
   * Letras viram o caractere original em maiúsculo; ocultas viram '_'; espaços
   * são preservados como ' '.
   */
  static mascarar(palavra: string, reveladas: Set<string>): string[] {
    return [...palavra].map((ch) => {
      if (ch.trim() === '') return ' ';
      return reveladas.has(WorMatchEntity.normalizar(ch)) ? ch.toUpperCase() : '_';
    });
  }

  /** Verdadeiro quando todas as letras (não-espaço) foram reveladas. */
  static estaCompleta(mascara: string[]): boolean {
    return !mascara.includes('_');
  }
}
