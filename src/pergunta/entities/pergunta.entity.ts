import { BadRequestException, ConflictException } from '@nestjs/common';
import { PERGUNTA } from '../pergunta.constants';

export type StatusPergunta = 'ABERTA' | 'ENCERRADA';
export type AutorMensagem = 'ALUNO' | 'PROFESSOR';
export type Aguardando = 'AGUARDANDO_PROFESSOR' | 'AGUARDANDO_ALUNO';

/**
 * Pergunta privada de um aluno ao professor da turma (spec 037). Coleção
 * fechada ao cliente; as mensagens ficam em `pergunta_mensagens`.
 */
export class PerguntaEntity {
  id: string;
  turmaId: string;
  professorId: string;
  alunoId: string;
  titulo: string;
  status: StatusPergunta = 'ABERTA';
  criadaEm: string;
  /** Hora da última mensagem: ordena a lista. */
  atualizadaEm: string;
  ultimaMensagemPor: AutorMensagem = 'ALUNO';
  totalMensagens = 0;
  /** Alguma mensagem tem anexo (ícone na lista do professor). */
  temAnexo?: boolean;
  encerradaEm?: string | null;
  encerradaPor?: AutorMensagem | null;

  constructor(partial: Partial<PerguntaEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Quem a pergunta está esperando (#8); null quando encerrada. */
  get aguardando(): Aguardando | null {
    if (this.status !== 'ABERTA') return null;
    return this.ultimaMensagemPor === 'ALUNO'
      ? 'AGUARDANDO_PROFESSOR'
      : 'AGUARDANDO_ALUNO';
  }

  /**
   * Monta a pergunta com a 1ª mensagem (do aluno) já contada. `abertasDoAluno`
   * são as perguntas ABERTAS que ele já tem na turma (#7).
   */
  static criar(
    dados: {
      turmaId: string;
      professorId: string;
      alunoId: string;
      titulo: string;
    },
    abertasDoAluno: number,
    agora = new Date(),
  ): PerguntaEntity {
    const titulo = (dados.titulo ?? '').trim();
    if (!titulo || titulo.length > PERGUNTA.TITULO_MAX) {
      throw new BadRequestException({
        code: 'TITULO_INVALIDO',
        message: `Dê um título de até ${PERGUNTA.TITULO_MAX} caracteres à pergunta.`,
      });
    }
    if (abertasDoAluno >= PERGUNTA.MAX_ABERTAS) {
      throw new ConflictException({
        code: 'LIMITE_PERGUNTAS',
        message: `Você já tem ${PERGUNTA.MAX_ABERTAS} perguntas abertas. Encerre uma antes de abrir outra.`,
      });
    }
    const iso = agora.toISOString();
    return new PerguntaEntity({
      turmaId: dados.turmaId,
      professorId: dados.professorId,
      alunoId: dados.alunoId,
      titulo,
      status: 'ABERTA',
      criadaEm: iso,
      atualizadaEm: iso,
      ultimaMensagemPor: 'ALUNO',
      totalMensagens: 1,
    });
  }

  /** Conta uma mensagem nova (#4, #7). */
  registrarMensagem(autor: AutorMensagem, agora = new Date()): void {
    if (this.status !== 'ABERTA') {
      throw new ConflictException({
        code: 'PERGUNTA_ENCERRADA',
        message: 'Esta pergunta foi encerrada.',
      });
    }
    if (this.totalMensagens >= PERGUNTA.MAX_MENSAGENS) {
      throw new ConflictException({
        code: 'LIMITE_MENSAGENS',
        message:
          'Esta conversa chegou ao limite de mensagens. Abra outra pergunta.',
      });
    }
    this.totalMensagens += 1;
    this.ultimaMensagemPor = autor;
    this.atualizadaEm = agora.toISOString();
  }

  /** Encerrar a já encerrada não muda nada (#5). */
  encerrar(por: AutorMensagem, agora = new Date()): void {
    if (this.status === 'ENCERRADA') return;
    this.status = 'ENCERRADA';
    this.encerradaPor = por;
    this.encerradaEm = agora.toISOString();
  }

  /** Só o professor reabre, e só a encerrada (#5). */
  reabrir(): void {
    if (this.status !== 'ENCERRADA') {
      throw new ConflictException({
        code: 'PERGUNTA_ABERTA',
        message: 'Esta pergunta já está aberta.',
      });
    }
    this.status = 'ABERTA';
    this.encerradaEm = null;
    this.encerradaPor = null;
  }
}
