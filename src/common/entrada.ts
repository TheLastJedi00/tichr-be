import { BadRequestException } from '@nestjs/common';
import { IsIn, ValidateIf } from 'class-validator';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

/**
 * Cronômetro de entrada do lobby (spec 035 §1), comum a Qlick, Wor e Isolateus.
 * Quando o prazo vence, a partida começa sozinha com quem entrou. Não há
 * agendador no backend (serverless): o início é preguiçoso e idempotente,
 * disparado pela tela do professor no zero ou pela leitura do aluno.
 */
export const DURACOES_ENTRADA = [30, 60, 120, 180, 300] as const;

/** Folga para diferença de relógio entre o cliente que dispara e o servidor. */
export const TOLERANCIA_ENTRADA_MS = 1000;

export class DefinirCronometroDto {
  /** Segundos da lista, ou `null` para cancelar. */
  @ValidateIf((o: DefinirCronometroDto) => o.segundos !== null)
  @IsIn(DURACOES_ENTRADA)
  segundos: number | null;
}

/** O prazo venceu sem gente suficiente: o lobby continua aberto (035 #8). */
export interface EntradaFalhou {
  motivo: 'POUCOS_INSCRITOS';
  inscritos: number;
  minimo: number;
  em: string;
}

/** Campos do cronômetro nas três partidas. */
export interface CamposEntrada {
  /** ISO do fim da entrada; `null`/ausente = sem cronômetro (início manual). */
  entradaEncerraEm?: string | null;
  entradaFalhou?: EntradaFalhou | null;
}

export function prazoDaEntrada(
  segundos: number | null,
  agora: number,
): string | null {
  return segundos === null
    ? null
    : new Date(agora + segundos * 1000).toISOString();
}

export function prazoVencido(
  entradaEncerraEm: string | null | undefined,
  agora: number,
): boolean {
  if (!entradaEncerraEm) return false;
  return Date.parse(entradaEncerraEm) <= agora + TOLERANCIA_ENTRADA_MS;
}

export function falhaDeEntrada(
  inscritos: number,
  minimo: number,
  agora: number,
): EntradaFalhou {
  return {
    motivo: 'POUCOS_INSCRITOS',
    inscritos,
    minimo,
    em: new Date(agora).toISOString(),
  };
}

export function assertLobbyCronometro(status: string): void {
  if (status !== 'LOBBY') {
    throw new BadRequestException({
      code: 'PARTIDA_INICIADA',
      message:
        'O cronômetro de entrada só pode ser usado antes de a partida começar.',
    });
  }
}

/**
 * Quem ganha o direito de iniciar. Numa transação: se a partida ainda está no
 * LOBBY e o prazo venceu, zera o cronômetro e devolve `true`. Dois disparos ao
 * mesmo tempo (telão + aluno): só o primeiro vê o prazo, o outro sai sem nada.
 */
export async function reivindicarEntrada(
  firestore: Firestore,
  ref: DocumentReference,
  agora: number,
): Promise<boolean> {
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    if (
      !d ||
      d.status !== 'LOBBY' ||
      !prazoVencido(d.entradaEncerraEm as string | null, agora)
    ) {
      return false;
    }
    tx.update(ref, { entradaEncerraEm: null });
    return true;
  });
}
