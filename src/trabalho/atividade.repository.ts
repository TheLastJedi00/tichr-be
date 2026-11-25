import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { AtividadeEntity } from './entities/atividade.entity';

/** `atividades` (spec 038): fechada ao cliente, só o backend lê e grava. */
@Injectable()
export class AtividadeRepository extends FirestoreRepository<AtividadeEntity> {
  protected readonly collectionName = 'atividades';
  protected readonly entity: ClassConstructor<AtividadeEntity> =
    AtividadeEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  /** Atividade e entrega mudam juntas (contadores): uma transação só. */
  transacao<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.firebase.firestore.runTransaction(fn);
  }

  ref(id: string): DocumentReference {
    return this.collection.doc(id);
  }

  async lerNaTransacao(
    tx: Transaction,
    id: string,
  ): Promise<AtividadeEntity | null> {
    const snap = await tx.get(this.ref(id));
    return snap.exists ? this.toEntity(snap.id, snap.data() ?? {}) : null;
  }

  gravarNaTransacao(tx: Transaction, a: AtividadeEntity): void {
    const { id, ...dados } = a;
    tx.set(this.ref(id), this.toPlain(dados));
  }

  excluirNaTransacao(tx: Transaction, id: string): void {
    tx.delete(this.ref(id));
  }

  /** Para o badge de "para avaliar" de todas as turmas do professor. */
  async doProfessor(professorId: string): Promise<AtividadeEntity[]> {
    return this.findBy('professorId', professorId);
  }

  /** Prazo mais próximo primeiro. */
  async daTurma(turmaId: string): Promise<AtividadeEntity[]> {
    return (await this.findBy('turmaId', turmaId)).sort((a, b) =>
      a.prazo.localeCompare(b.prazo),
    );
  }
}
