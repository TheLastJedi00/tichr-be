/** Constantes de balanceamento. Centralizadas para tuning posterior. */
export const WOR = {
  HP_INICIAL: 1000,
  /** Ataque padrão (rodada normal). */
  DANO_ATAQUE: 100,
  /** Ataque crítico (rodada em que TODOS os membros acertaram a letra). */
  DANO_CRITICO: 200,
  /** Cura ao acertar a palavra inteira (Risco Heroico). */
  CURA_MASSIVA: 400,
  MAX_CARTAS: 3,
} as const;

/** Tamanho-alvo de equipe pelo nº de alunos na sala (máx. 4 por equipe). */
export function tamanhoEquipe(alunos: number): number {
  if (alunos < 4) return 1;
  if (alunos < 6) return 2;
  if (alunos < 8) return 3;
  return 4;
}

export type StatusMatch = 'LOBBY' | 'EM_ANDAMENTO' | 'ENCERRADO';

export interface InscritoWor {
  alunoId: string;
  nome: string;
}

/** Voto do membro (só conta se ele acertou a letra). */
export type VotoRodada =
  | { tipo: 'ATACAR'; alvoEquipeId: string }
  | { tipo: 'DICA' };

/** Ação de um membro na rodada da sua equipe. */
export interface AcaoMembro {
  alunoId: string;
  /** 'LETRA' = chutou uma letra; 'ARRISCAR' = tentou a palavra e errou. */
  tipo: 'LETRA' | 'ARRISCAR';
  letra?: string;
  acertou: boolean;
  /** Voto (atacar rival ou comprar dica); só apurado se `acertou`. */
  voto?: VotoRodada;
  /** Ordem de chegada na rodada (desempate da votação). */
  ordem: number;
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
  /** Turma da partida (opcional, como no Qlick — derivada do vínculo da batalha). */
  turmaId?: string | null;
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

  /** Turno (por equipe) e ordem de round-robin. */
  turnoEquipeId?: string | null;
  ordemEquipes: string[] = [];
  /**
   * Ações já feitas pelos membros da equipe do turno NESTA rodada. A rodada
   * resolve (dano/dica + passa turno) quando todos os membros da equipe agiram.
   */
  acoesRodada: AcaoMembro[] = [];

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
