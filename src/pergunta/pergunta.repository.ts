import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { PerguntaEntity } from './entities/pergunta.entity';

/** `perguntas` (spec 037): fechada ao cliente, só o backend lê e grava. */
@Injectable()
export class PerguntaRepository extends FirestoreRepository<PerguntaEntity> {
  protected readonly collectionName = 'perguntas';
  protected readonly entity: ClassConstructor<PerguntaEntity> = PerguntaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  /** Pergunta e mensagem mudam juntas: tudo numa transação só. */
  transacao<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.firebase.firestore.runTransaction(fn);
  }

  ref(id: string): DocumentReference {
    return this.collection.doc(id);
  }

  /** Um id antes de gravar: o anexo sobe com o caminho já definido. */
  novoId(): string {
    return this.collection.doc().id;
  }

  async lerNaTransacao(
    tx: Transaction,
    id: string,
  ): Promise<PerguntaEntity | null> {
    const snap = await tx.get(this.ref(id));
    return snap.exists ? this.toEntity(snap.id, snap.data() ?? {}) : null;
  }

  gravarNaTransacao(tx: Transaction, p: PerguntaEntity): void {
    const { id, ...dados } = p;
    tx.set(this.ref(id), this.toPlain(dados));
  }

  /** Duas igualdades: o Firestore resolve sem índice composto. */
  async abertasDoProfessor(professorId: string): Promise<PerguntaEntity[]> {
    const snap = await this.collection
      .where('professorId', '==', professorId)
      .where('status', '==', 'ABERTA')
      .get();
    return snap.docs.map((doc) => this.toEntity(doc.id, doc.data()));
  }
}
