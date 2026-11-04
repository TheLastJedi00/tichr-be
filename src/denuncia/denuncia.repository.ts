import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { DenunciaEntity } from './entities/denuncia.entity';

@Injectable()
export class DenunciaRepository extends FirestoreRepository<DenunciaEntity> {
  protected readonly collectionName = 'denuncias';
  protected readonly entity: ClassConstructor<DenunciaEntity> = DenunciaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  ref(id: string): DocumentReference {
    return this.collection.doc(id);
  }

  /** Duas igualdades: o Firestore resolve sem índice composto. */
  async pendentesDoProfessor(professorId: string): Promise<DenunciaEntity[]> {
    const snap = await this.collection
      .where('professorId', '==', professorId)
      .where('status', '==', 'PENDENTE')
      .get();
    return snap.docs.map((doc) => this.toEntity(doc.id, doc.data()));
  }

  /** Leitura dentro de uma transação alheia (a do XP, na validação). */
  async lerNaTransacao(tx: Transaction, id: string): Promise<DenunciaEntity> {
    const snap = await tx.get(this.ref(id));
    return this.toEntity(snap.id, snap.data() ?? {});
  }

  gravarNaTransacao(
    tx: Transaction,
    id: string,
    patch: Partial<DenunciaEntity>,
  ): void {
    tx.update(this.ref(id), this.toPlain(patch));
  }

  /**
   * Resolve sem XP (invalidar, ou turma sem pontuação) numa transação: duas
   * resoluções simultâneas não passam as duas pela checagem de pendente.
   */
  async resolverSePendente(
    id: string,
    patch: Partial<DenunciaEntity>,
  ): Promise<void> {
    await this.firebase.firestore.runTransaction(async (tx) => {
      const atual = await this.lerNaTransacao(tx, id);
      atual.assertPendente();
      this.gravarNaTransacao(tx, id, patch);
    });
  }
}
