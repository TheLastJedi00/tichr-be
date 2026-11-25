import { BadRequestException, ConflictException } from '@nestjs/common';
import { TRABALHO } from '../trabalho.constants';

export interface DadosAtividade {
  titulo?: string;
  descricao?: string | null;
  /** ISO com data e hora limite (038 #2). */
  prazo?: string;
  valorPontos?: number;
}

function erro(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

function titulo(v: string | undefined): string {
  const t = (v ?? '').trim();
  if (!t || t.length > TRABALHO.TITULO_MAX) {
    erro(
      'TITULO_INVALIDO',
      `Dê um título de até ${TRABALHO.TITULO_MAX} caracteres ao trabalho.`,
    );
  }
  return t;
}

function descricao(v: string | null | undefined): string | null {
  const d = (v ?? '').trim();
  if (d.length > TRABALHO.DESCRICAO_MAX) {
    erro(
      'DESCRICAO_GRANDE',
      `A descrição pode ter até ${TRABALHO.DESCRICAO_MAX} caracteres.`,
    );
  }
  return d || null;
}

/**
 * Prazo com data E hora (038 #2): uma data sem hora ("2026-12-05") é recusada
 * para o fim do envio nunca cair num horário implícito. Guardado em ISO UTC.
 */
function prazo(v: string | undefined): string {
  if (!v || !v.trim()) {
    erro('PRAZO_OBRIGATORIO', 'Informe a data e a hora limite do trabalho.');
  }
  const ms = Date.parse(v);
  if (!/T\d{2}:\d{2}/.test(v) || Number.isNaN(ms)) {
    erro('PRAZO_INVALIDO', 'O prazo precisa ter data e hora limite.');
  }
  return new Date(ms).toISOString();
}

function valor(v: number | undefined): number {
  if (v === undefined) return TRABALHO.VALOR_PADRAO;
  if (!Number.isInteger(v) || v < 0 || v > TRABALHO.VALOR_MAX) {
    erro(
      'VALOR_INVALIDO',
      `O trabalho vale de 0 a ${TRABALHO.VALOR_MAX} pontos.`,
    );
  }
  return v;
}

/**
 * Trabalho pedido pelo professor numa turma (spec 038). Coleção `atividades`,
 * fechada ao cliente; as entregas ficam em `entregas`.
 */
export class AtividadeEntity {
  id: string;
  turmaId: string;
  professorId: string;
  titulo: string;
  descricao?: string | null;
  /** ISO UTC: o envio fecha quando `agora > prazo` (#11). */
  prazo: string;
  valorPontos: number = TRABALHO.VALOR_PADRAO;
  criadaEm: string;
  atualizadaEm: string;
  /** Entregas que contam (texto ou arquivo): bloqueia a exclusão (#5). */
  totalEntregas = 0;
  /** Entregas que contam e ainda não têm nota: badge do professor. */
  aguardandoAvaliacao = 0;

  constructor(partial: Partial<AtividadeEntity> = {}) {
    Object.assign(this, partial);
  }

  static criar(
    dados: DadosAtividade & { turmaId: string; professorId: string },
    agora = new Date(),
  ): AtividadeEntity {
    const p = prazo(dados.prazo);
    if (Date.parse(p) <= agora.getTime()) {
      erro('PRAZO_NO_PASSADO', 'O prazo precisa ser depois de agora.');
    }
    const iso = agora.toISOString();
    return new AtividadeEntity({
      turmaId: dados.turmaId,
      professorId: dados.professorId,
      titulo: titulo(dados.titulo),
      descricao: descricao(dados.descricao),
      prazo: p,
      valorPontos: valor(dados.valorPontos),
      criadaEm: iso,
      atualizadaEm: iso,
      totalEntregas: 0,
      aguardandoAvaliacao: 0,
    });
  }

  /**
   * Edita qualquer campo (#4). O prazo pode ir para o passado: é o jeito de o
   * professor encerrar o envio antes da hora.
   */
  editar(dados: DadosAtividade, agora = new Date()): void {
    if (dados.titulo !== undefined) this.titulo = titulo(dados.titulo);
    if (dados.descricao !== undefined) {
      this.descricao = descricao(dados.descricao);
    }
    if (dados.prazo !== undefined) this.prazo = prazo(dados.prazo);
    if (dados.valorPontos !== undefined) {
      this.valorPontos = valor(dados.valorPontos);
    }
    this.atualizadaEm = agora.toISOString();
  }

  /** Recebe entregas até o minuto do prazo, inclusive (#11). */
  aberta(agora = new Date()): boolean {
    return agora.getTime() <= Date.parse(this.prazo);
  }

  /**
   * Ajusta os contadores quando uma entrega muda (mesma transação dela): passa
   * a contar ao ganhar texto/arquivo, deixa de contar ao ficar vazia e sai de
   * "para avaliar" ao receber nota.
   */
  contarEntrega(
    antes: { entregue: boolean; avaliada: boolean },
    depois: { entregue: boolean; avaliada: boolean },
  ): void {
    const conta = (e: { entregue: boolean }) => (e.entregue ? 1 : 0);
    const aguarda = (e: { entregue: boolean; avaliada: boolean }) =>
      e.entregue && !e.avaliada ? 1 : 0;
    this.totalEntregas = Math.max(
      0,
      (this.totalEntregas ?? 0) + conta(depois) - conta(antes),
    );
    this.aguardandoAvaliacao = Math.max(
      0,
      (this.aguardandoAvaliacao ?? 0) + aguarda(depois) - aguarda(antes),
    );
  }

  garantirExcluivel(): void {
    if (this.totalEntregas > 0) {
      throw new ConflictException({
        code: 'ATIVIDADE_COM_ENTREGAS',
        message:
          'Este trabalho já tem entregas e não pode ser excluído. Altere o prazo para encerrar o envio.',
      });
    }
  }
}
