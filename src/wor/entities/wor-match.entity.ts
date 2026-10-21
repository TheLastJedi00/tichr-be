import { LogPontuacaoJogador } from '../../common/log-pontuacao';

/** Constantes de balanceamento. Centralizadas para tuning posterior. */
export const WOR = {
  HP_INICIAL: 1000,
  /** Ataque padrão (rodada normal). */
  DANO_ATAQUE: 100,
  /** Ataque crítico (rodada em que TODOS os membros acertaram a letra). */
  DANO_CRITICO: 200,
  /** Cura ao acertar a palavra inteira (Risco Heroico → Recuperar HP). */
  CURA_MASSIVA: 400,
  /** Dano num castelo rival ao acertar a palavra inteira (Risco Heroico → Catapulta). */
  DANO_CATAPULTA: 300,
  MAX_CARTAS: 3,
  // ===== Pontuação (desempate por pontos + crédito no ranking da sala) =====
  /** Pontos ganhos por ponto de dano causado a um rival (100 normal / 200 crít). */
  PONTOS_POR_DANO: 1,
  /** Bônus por arriscar a palavra inteira e acertar (Risco Heroico / Invasão). */
  BONUS_ARRISCAR: 300,
  // ===== Bônus INDIVIDUAL (029 §6A) =====
  // Só para o aluno que acertou, fora do `team.pontos` (dividido igual entre
  // os membros). Com o multiplicador e sem o ×0,5 da não campeã.
  /** Arriscar a palavra inteira e acertar (Risco Heroico ou Invasão). */
  BONUS_ACERTO_PALAVRA: 1000,
  /** Cada letra certa, creditada no fechamento da rodada. */
  BONUS_ACERTO_LETRA: 300,
  /** Bônus de intactez no fim: `+hp * fator` (recompensa terminar de pé). */
  BONUS_HP_FATOR: 1,
  /**
   * Conversão pontos-de-jogo → XP da sala (campeã ×1, demais ×0,5).
   *
   * Era 0,1: uma equipe campeã com 2000 pontos levava 200 XP, enquanto um Qlick
   * de 10 questões rende ~10000. Agora 1:1, a mesma régua do Qlick e do
   * Isolateus.
   */
  XP_POR_PONTO: 1,
  /**
   * Multiplicador de pontos escolhido pelo professor no lobby (inteiro). Vale
   * para todo ponto ganho na partida: dano, arriscar e o bônus de HP do fim.
   */
  MULTIPLICADOR_MIN: 1,
  MULTIPLICADOR_MAX: 10,
  /** Duração do Action Card — e do congelamento do jogo enquanto ele está no ar. */
  FREEZE_MS: 3000,
  // ===== Chat da equipe =====
  /** Tamanho máximo de uma mensagem (depois do trim). */
  CHAT_MAX_CARACTERES: 200,
  /** Quantas mensagens o canal guarda (as mais antigas saem). */
  CHAT_MAX_MENSAGENS: 50,
  /** Intervalo mínimo entre duas mensagens do mesmo aluno. */
  CHAT_INTERVALO_MS: 2000,
  /** Penalidade por linguagem imprópria: XP do aluno no ranking da sala… */
  PENALIDADE_XP: 1000,
  /** …e HP do castelo da equipe. */
  PENALIDADE_HP: 100,
} as const;

/** Gatilhos narrados por um Action Card (interrupção global de 3s). */
export type TipoAcaoGlobal =
  | 'ATAQUE'
  | 'CURA'
  | 'CATAPULTA'
  | 'USURPACAO'
  | 'DANO_CRITICO'
  | 'DICA'
  | 'MODERACAO'
  | 'QUEDA';

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
  { tipo: 'ATACAR'; alvoEquipeId: string } | { tipo: 'DICA' };

/** Ação de um membro na rodada (server-only, em `privado/rodada`). */
export interface AcaoMembro {
  alunoId: string;
  /** Equipe do membro: todas as equipes jogam a mesma rodada (029 §1). */
  equipeId: string;
  /** 'LETRA' = chutou uma letra; 'ARRISCAR' = tentou a palavra e errou. */
  tipo: 'LETRA' | 'ARRISCAR';
  letra?: string;
  acertou: boolean;
  /** Voto (atacar rival ou comprar dica); só apurado se `acertou`. */
  voto?: VotoRodada;
  /** Ordem de chegada na rodada (desempate da votação). */
  ordem: number;
  /** Hora da ação (ISO): ordena as equipes que fecham por tempo (029 #8). */
  em: string;
}

/** Como a equipe fechou a rodada (029 §1.2). `CAIU` = o castelo caiu antes. */
export type ResultadoFechamento = 'ATACAR' | 'DICA' | 'NADA' | 'CAIU';

/** Equipe que já fechou a rodada, na ordem de chegada (público). */
export interface EquipeFechada {
  equipeId: string;
  /** 1 = fechou primeiro. */
  ordem: number;
  resultado: ResultadoFechamento;
}

/** Evento da rodada que não congela o jogo (029 §3). */
export interface ItemFeed {
  seq: number;
  tipo: 'ATAQUE' | 'DICA' | 'DANO_CRITICO';
  mensagem: string;
  em: string;
}

/** O resultado de uma equipe na rodada (reveal do fechamento). */
export interface ResultadoRodadaEquipe {
  equipeId: string;
  equipeNome: string;
  ordem: number;
  /** Membros que acertaram a letra nesta rodada. */
  acertadores: { nome: string; letra: string }[];
  acao: ResultadoFechamento;
  alvoEquipeId?: string;
  alvoNome?: string;
  dano?: number;
  critico?: boolean;
}

/**
 * Tempo-limite de uma rodada. Desde a 029 vale para todas as equipes ao mesmo
 * tempo: um relógio só, visível no telão e nos celulares.
 */
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

/**
 * A última rodada fechada: o reveal para todos, com o resultado de cada equipe
 * na ordem em que elas fecharam (029 §2.2).
 */
export interface ResumoRodada {
  /** Incrementa a cada rodada fechada (o cliente detecta rodada nova). */
  seq: number;
  /** Na ordem em que as equipes fecharam. */
  resultados: ResultadoRodadaEquipe[];
  /** A rodada foi fechada por tempo esgotado. */
  porTempo?: boolean;
}

/**
 * O que a rodada em curso guarda longe do cliente (`matches/{id}/privado/rodada`,
 * deny pelo catch-all das rules): a letra e o acerto de cada membro, e o
 * resultado de quem já fechou. Na raiz pública, deixariam uma equipe copiar a
 * resposta da outra antes do reveal (029 §2.1).
 */
export class WorRodadaPrivada {
  acoes: AcaoMembro[] = [];
  resultados: ResultadoRodadaEquipe[] = [];

  constructor(partial: Partial<WorRodadaPrivada> = {}) {
    Object.assign(this, partial);
  }
}

/**
 * Estado GLOBAL (raiz `matches/{id}`) de uma batalha do Tichr Wor. É lido pelo
 * cliente (professor e alunos), então **NÃO** guarda o segredo: a palavra e as
 * dicas completas ficam em `wor_jogos` (server-only). Aqui vai só a máscara, as
 * cartas já reveladas e o controle da rodada/onda. Escrita só pelo backend.
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

  /**
   * Quanto valem os pontos desta partida (1x a 10x), definido pelo professor no
   * lobby e fixo depois do início. Público: o lobby e o telão mostram o valor.
   * Partidas antigas (sem o campo) valem 1x.
   */
  multiplicador = 1;

  /**
   * Desmarcado no lobby, a partida é casual: placar e log normais, sem crédito
   * no ranking da turma (spec 027 §3). Partidas antigas valem.
   */
  valeRanking = true;

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

  /** Ordem das equipes (exibição; desde a 029 não há mais rodízio). */
  ordemEquipes: string[] = [];
  /**
   * Quem já agiu na rodada em curso (`alunoId`). É o lado público das ações:
   * a letra e o acerto ficam em `privado/rodada` (029 §2.1).
   */
  jaAgiram: string[] = [];
  /** Equipes que já fecharam a rodada em curso, na ordem de chegada. */
  equipesFechadas: EquipeFechada[] = [];
  /** Eventos da rodada em curso que não congelam o jogo (029 §3). */
  feedRodada: ItemFeed[] = [];
  /** Contador do feed (não zera entre rodadas: é o gatilho do cliente). */
  feedSeq = 0;
  /** Início da rodada atual (ISO) — base do cronômetro de 1 min no cliente. */
  rodadaIniciadaEm?: string | null;

  /**
   * Quando o professor pausou a partida (ISO); `null`/ausente = rodando
   * (028 §4). Pausada, só Retomar passa; os relógios das telas param.
   */
  pausadaEm?: string | null;

  /** Snapshot de todas as equipes (castelos) — todos leem da raiz, sem custo por equipe. */
  placar: PlacarEquipe[] = [];
  /** Resultado da última rodada resolvida (reveal + quem atacou). */
  resumoRodada?: ResumoRodada | null;
  /** Último Action Card emitido (narração global + freeze de 3s). */
  lastGlobalAction?: LastGlobalAction | null;

  inscritos: InscritoWor[] = [];
  vencedorEquipeId?: string | null;

  /** De onde veio cada ponto, por aluno (spec 027 §1). Só no encerramento. */
  logPontuacao?: LogPontuacaoJogador[];

  constructor(partial: Partial<WorMatchEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Normaliza uma letra para comparação: maiúscula, sem acento. */
  static normalizar(letra: string): string {
    return letra.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }

  /**
   * Máscara da palavra dado o conjunto de letras reveladas (normalizadas).
   * Letras viram o caractere original em maiúsculo; ocultas viram '_'; espaços
   * são preservados como ' '.
   */
  static mascarar(palavra: string, reveladas: Set<string>): string[] {
    return [...palavra].map((ch) => {
      if (ch.trim() === '') return ' ';
      return reveladas.has(WorMatchEntity.normalizar(ch))
        ? ch.toUpperCase()
        : '_';
    });
  }

  /** Verdadeiro quando todas as letras (não-espaço) foram reveladas. */
  static estaCompleta(mascara: string[]): boolean {
    return !mascara.includes('_');
  }
}
