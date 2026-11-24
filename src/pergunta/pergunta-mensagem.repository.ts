import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { Transaction } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { PerguntaMensagemEntity } from './entities/pergunta-mensagem.entity';

/** `pergunta_mensagens` (spec 037): fechada ao cliente. */
@Injectable()
export class PerguntaMensagemRepository extends FirestoreRepository<PerguntaMensagemEntity> {
  protected readonly collectionName = 'pergunta_mensagens';
  protected readonly entity: ClassConstructor<PerguntaMensagemEntity> =
    PerguntaMensagemEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  novoId(): string {
    return this.collection.doc().id;
  }

  gravarNaTransacao(tx: Transaction, m: PerguntaMensagemEntity): void {
    const { id, ...dados } = m;
    tx.set(this.collection.doc(id), this.toPlain(dados));
  }

  /** A conversa em ordem cronológica. */
  async daPergunta(perguntaId: string): Promise<PerguntaMensagemEntity[]> {
    return (await this.findBy('perguntaId', perguntaId)).sort(
      (a, b) =>
        a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id),
    );
  }
}
