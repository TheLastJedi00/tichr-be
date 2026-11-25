import { BadRequestException } from '@nestjs/common';
import type { ExtensaoAnexo } from '../../common/anexo';
import { PERGUNTA } from '../pergunta.constants';
import type { AutorMensagem } from './pergunta.entity';

export interface AnexoMensagem {
  /** Caminho privado no Storage: nunca sai do backend. */
  path: string;
  nome: string;
  extensao: ExtensaoAnexo;
  tamanho: number;
}

/** Uma mensagem da conversa de uma pergunta (spec 037 #6). */
export class PerguntaMensagemEntity {
  id: string;
  perguntaId: string;
  turmaId: string;
  autor: AutorMensagem;
  texto?: string;
  anexo?: AnexoMensagem;
  criadaEm: string;

  constructor(partial: Partial<PerguntaMensagemEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Texto ou anexo, texto até 2.000 caracteres (#7). */
  static criar(
    dados: {
      perguntaId: string;
      turmaId: string;
      autor: AutorMensagem;
      texto?: string;
      anexo?: AnexoMensagem;
    },
    agora = new Date(),
  ): PerguntaMensagemEntity {
    const texto = dados.texto?.trim() || undefined;
    if (!texto && !dados.anexo) {
      throw new BadRequestException({
        code: 'MENSAGEM_VAZIA',
        message: 'Escreva uma mensagem ou anexe um arquivo.',
      });
    }
    if (texto && texto.length > PERGUNTA.TEXTO_MAX) {
      throw new BadRequestException({
        code: 'TEXTO_LONGO',
        message: `A mensagem pode ter até ${PERGUNTA.TEXTO_MAX} caracteres.`,
      });
    }
    const m = new PerguntaMensagemEntity({
      perguntaId: dados.perguntaId,
      turmaId: dados.turmaId,
      autor: dados.autor,
      criadaEm: agora.toISOString(),
    });
    if (texto) m.texto = texto;
    if (dados.anexo) m.anexo = dados.anexo;
    return m;
  }
}
