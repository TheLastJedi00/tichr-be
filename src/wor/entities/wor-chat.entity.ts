import { HttpException, HttpStatus } from '@nestjs/common';
import { WOR } from './wor-match.entity';

export interface MensagemChat {
  id: string;
  alunoId: string;
  nome: string;
  texto: string;
  em: string;
}

/** Qual canal pertence a qual equipe (`wor_canais/{matchId}`, server-only). */
export interface CanalEquipe {
  teamId: string;
  canalId: string;
}

/**
 * O chat privado de uma equipe (`wor_chats/{canalId}`). As rules liberam `get`
 * e negam `list`: só lê quem sabe o `canalId`, um UUID que o backend entrega
 * apenas aos membros da equipe — ele nunca aparece em `matches/**`, que é
 * público. Escrita só pelo backend.
 */
export class WorChatEntity {
  id: string;
  matchId: string;
  teamId: string;
  mensagens: MensagemChat[] = [];

  constructor(partial: Partial<WorChatEntity> = {}) {
    Object.assign(this, partial);
  }

  /**
   * Anexa a mensagem respeitando o intervalo mínimo por aluno e mantém só as
   * últimas `CHAT_MAX_MENSAGENS`. Rodada dentro da transação do repositório,
   * então duas mensagens simultâneas do mesmo aluno não furam o intervalo.
   */
  static anexar(mensagens: MensagemChat[], nova: MensagemChat): MensagemChat[] {
    const ultima = [...mensagens]
      .reverse()
      .find((m) => m.alunoId === nova.alunoId);
    if (
      ultima &&
      Date.parse(nova.em) - Date.parse(ultima.em) < WOR.CHAT_INTERVALO_MS
    ) {
      throw new HttpException(
        {
          code: 'CHAT_RAPIDO',
          message: 'Calma! Espere um instante antes de mandar outra mensagem.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return [...mensagens, nova].slice(-WOR.CHAT_MAX_MENSAGENS);
  }
}
