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
  // ===== Pontuação (desempate por pontos + crédito no ranking da sala) =====
  /** Pontos ganhos por ponto de dano causado a um rival (100 normal / 200 crít). */
  PONTOS_POR_DANO: 1,
  /** Bônus por arriscar a palavra inteira e acertar (Risco Heroico / Invasão). */
  BONUS_ARRISCAR: 300,
  /** Bônus de intactez no fim: `+hp * fator` (recompensa terminar de pé). */
  BONUS_HP_FATOR: 1,
  /** Conversão pontos-de-jogo → XP da sala (campeã ×1, demais ×0,5). */
  XP_POR_PONTO: 0.1,
  /** Duração do Action Card — e do congelamento do jogo enquanto ele está no ar. */
  FREEZE_MS: 3000,
} as const;

/** Gatilhos narrados por um Action Card (interrupção global de 3s). */
export type TipoAcaoGlobal =
  | 'ATAQUE'
  | 'CURA'
  | 'USURPACAO'
  | 'DANO_CRITICO'
  | 'DICA';

/**
 * Evento de impacto narrado em TODAS as telas (alunos + telão) ao mesmo tempo.
 * Vai por fan-out para a raiz e para cada equipe: o aluno escuta só o doc da
 * própria equipe, então é lá que o card precisa chegar. O cliente detecta `seq`
 * novo, exibe o card por `duracaoMs` e trava os inputs.
 */
export interface LastGlobalAction {
  /** Incrementa a cada card emitido (o cliente detecta o evento novo). */
  seq: number;
  tipo: TipoAcaoGlobal;
  mensagem: string;
  duracaoMs: number;
  em: string;
}

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

/** Tempo-limite de uma rodada (turno de equipe). Cronômetro visível no cliente. */
export const LIMITE_RODADA_MS = 60 * 1000;

/** Snapshot público de uma equipe na raiz (o aluno vê os castelos rivais barato). */
export interface PlacarEquipe {
  id: string;
  nome: string;
  cor: string;
  hp: number;
  isHorde: boolean;
  /** Pontos de combate acumulados (dano causado + bônus) — barra acima do HP. */
  pontos: number;
}

/** Resultado da última rodada resolvida — reveal para todos + quem atacou quem. */
export interface ResumoRodada {
  /** Incrementa a cada rodada resolvida (o cliente detecta rodada nova). */
  seq: number;
  equipeId: string;
  equipeNome: string;
  /** Membros que acertaram a letra nesta rodada. */
  acertadores: { nome: string; letra: string }[];
  acao: 'ATACAR' | 'DICA' | 'NADA';
  alvoEquipeId?: string;
  alvoNome?: string;
  dano?: number;
  critico?: boolean;
  /** A rodada foi encerrada por tempo esgotado. */
  porTempo?: boolean;
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
  /** Início do turno/rodada atual (ISO) — base do cronômetro de 1 min no cliente. */
  rodadaIniciadaEm?: string | null;

  /** Snapshot de todas as equipes (castelos) — todos leem da raiz, sem custo por equipe. */
  placar: PlacarEquipe[] = [];
  /** Resultado da última rodada resolvida (reveal + quem atacou). */
  resumoRodada?: ResumoRodada | null;
  /** Último Action Card emitido (narração global + freeze de 3s). */
  lastGlobalAction?: LastGlobalAction | null;

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
