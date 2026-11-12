import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { DenunciaGrupoEntity } from './entities/denuncia-grupo.entity';

/** `denuncia_grupos` (spec 033): fechada ao cliente. */
@Injectable()
export class DenunciaGrupoRepository extends FirestoreRepository<DenunciaGrupoEntity> {
  protected readonly collectionName = 'denuncia_grupos';
  protected readonly entity: ClassConstructor<DenunciaGrupoEntity> =
    DenunciaGrupoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  ref(id: string): DocumentReference {
    return this.collection.doc(id);
  }

  /** Um id novo antes de gravar: o grupo e as denúncias vão no mesmo commit. */
  novoId(): string {
    return this.collection.doc().id;
  }

  async lerNaTransacao(
    tx: Transaction,
    id: string,
  ): Promise<DenunciaGrupoEntity | null> {
    const snap = await tx.get(this.ref(id));
    return snap.exists ? this.toEntity(snap.id, snap.data() ?? {}) : null;
  }

  gravarNaTransacao(tx: Transaction, g: DenunciaGrupoEntity): void {
    const { id, ...dados } = g;
    tx.set(this.ref(id), this.toPlain(dados));
  }

  apagarNaTransacao(tx: Transaction, id: string): void {
    tx.delete(this.ref(id));
  }
}
