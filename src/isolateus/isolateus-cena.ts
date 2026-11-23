/**
 * Geometria da cena 2D do Isolateus (spec 034).
 *
 * Constantes e funções puras compartilhadas com o FE (o arquivo é espelhado em
 * `tichr-fe/src/app/core/isolateus-cena.ts`). A posição dentro do setor é só
 * visual: o backend nunca a usa para decidir nada, só calcula de onde a
 * caminhada sai para que real e NPC gravem o mesmo formato.
 */
import { vizinhosDe } from './isolateus.data';

export const CENA = {
  /** Resolução lógica (px); o celular escala em múltiplos inteiros. */
  LARGURA: 320,
  ALTURA: 180,
  /** Velocidade fixa da caminhada, em px por segundo. */
  VELOCIDADE: 48,
  /** Onde o habitante nasce no setor (sem passo anterior). */
  X_INICIAL: 160,
  /**
   * Intervalo mínimo entre dois passos do mesmo habitante (429 `PASSO_RAPIDO`).
   * 250 ms (036 #25): apertar e soltar uma tecla gera dois passos seguidos.
   */
  PASSO_INTERVALO_MS: 250,
  /**
   * Distância máxima (px) entre o boneco e a porta para atravessar (036 #19 e
   * #21): o botão flutuante aparece dentro dela e o servidor confere.
   */
  ZONA_PORTA: 28,
  /** Ao chegar por uma porta, o boneco anda isto para dentro da cena. */
  ENTRADA_PORTA: 44,
  /** NPCs: no máximo uma rodada de passeio a cada tanto, por partida. */
  NPC_PULSO_MS: 3_000,
  /** Chance de um NPC solto escolher um novo alvo a cada rodada de passeio. */
  NPC_CHANCE_PASSEAR: 0.3,
} as const;

export type LadoPorta = 'esquerda' | 'direita' | 'fundo';

/** O x de cada porta. A do fundo fica à direita do centro (o centro é do botão). */
export const PORTA_X: Record<LadoPorta, number> = {
  esquerda: 24,
  direita: 296,
  fundo: 220,
};

/** Coluna de cada setor no mapa da vila (espelho de `core/isolateus-mapa.ts`). */
const COLUNA: Record<string, number> = {
  seguranca: 1,
  comercio: 1,
  energia: 2,
  saude: 2,
  comunicacao: 3,
  abastecimento: 4,
};

export interface PortaCena {
  para: string;
  lado: LadoPorta;
  x: number;
}

/**
 * As portas de um setor: o lado segue a posição do vizinho no mapa (coluna
 * maior = direita, senão esquerda). A Comunicação manda a Saúde, que fica
 * abaixo no mapa, para uma porta no fundo.
 */
export function portasDe(setorId: string): PortaCena[] {
  return vizinhosDe(setorId).map((para) => {
    let lado: LadoPorta =
      (COLUNA[para] ?? 0) > (COLUNA[setorId] ?? 0) ? 'direita' : 'esquerda';
    if (setorId === 'comunicacao' && para === 'saude') lado = 'fundo';
    return { para, lado, x: PORTA_X[lado] };
  });
}

/** O x da porta de `de` para `para` (undefined sem estrada). */
export function xDaPorta(de: string, para: string): number | undefined {
  return portasDe(de).find((p) => p.para === para)?.x;
}

/**
 * A entrada por uma porta: o boneco aparece no batente que liga de volta à
 * origem e caminha um pouco para dentro (fora da zona, para o botão de voltar
 * não aparecer sozinho).
 */
export function chegadaPelaPorta(
  de: string,
  para: string,
): { x: number; alvoX: number } {
  const x = xDaPorta(para, de) ?? CENA.X_INICIAL;
  const dentro = x < CENA.LARGURA / 2 ? 1 : -1;
  return { x, alvoX: x + dentro * CENA.ENTRADA_PORTA };
}

export function alvoDentroDaCena(alvoX: number): boolean {
  return Number.isFinite(alvoX) && alvoX >= 0 && alvoX <= CENA.LARGURA;
}

export interface Passo {
  x: number;
  alvoX: number;
  t: number;
}

/** Onde a caminhada está em `agora`: linear, velocidade fixa, para no alvo. */
export function posicaoEm(passo: Passo, agora: number): number {
  const decorrido = Math.max(0, agora - passo.t) / 1000;
  const dist = Math.abs(passo.alvoX - passo.x);
  const andou = Math.min(dist, decorrido * CENA.VELOCIDADE);
  return passo.x + Math.sign(passo.alvoX - passo.x) * andou;
}
