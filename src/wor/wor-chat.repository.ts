import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { CanalEquipe, MensagemChat } from './entities/wor-chat.entity';

/**
 * Chats das equipes. Duas coleções:
 * - `wor_canais/{matchId}` (deny-all): o mapa equipe → `canalId`. É o segredo;
 * - `wor_chats/{canalId}` (`get` liberado, `list` negado): as mensagens. Sem o
 *   `canalId`, não há como chegar ao doc.
 */
@Injectable()
export class WorChatRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get canais() {
    return this.firebase.firestore.collection('wor_canais');
  }
  private get chats() {
    return this.firebase.firestore.collection('wor_chats');
  }

  /**
   * Devolve os canais da partida, criando (numa transação) os das equipes que
   * ainda não têm. Idempotente: dois colegas abrindo o chat ao mesmo tempo
   * recebem o mesmo canal.
   */
  async garantirCanais(
    matchId: string,
    teamIds: string[],
  ): Promise<CanalEquipe[]> {
    const db = this.firebase.firestore;
    const ref = this.canais.doc(matchId);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const atuais = (snap.data()?.canais as CanalEquipe[] | undefined) ?? [];
      const novos = teamIds
        .filter((teamId) => !atuais.some((c) => c.teamId === teamId))
        .map((teamId) => ({ teamId, canalId: randomUUID() }));
      if (novos.length) {
        tx.set(ref, { canais: [...atuais, ...novos] });
        for (const { teamId, canalId } of novos) {
          tx.set(this.chats.doc(canalId), { matchId, teamId, mensagens: [] });
        }
      }
      return [...atuais, ...novos];
    });
  }

  /** Lê e regrava as mensagens do canal numa transação. */
  async atualizarMensagens(
    canalId: string,
    mudar: (atuais: MensagemChat[]) => MensagemChat[],
  ): Promise<void> {
    const db = this.firebase.firestore;
    const ref = this.chats.doc(canalId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const atuais =
        (snap.data()?.mensagens as MensagemChat[] | undefined) ?? [];
      tx.set(ref, { mensagens: mudar(atuais) }, { merge: true });
    });
  }
}
