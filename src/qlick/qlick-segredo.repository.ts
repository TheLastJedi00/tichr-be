import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { QlickSegredoEntity } from './entities/qlick-segredo.entity';

/**
 * Cofre do Qlick (`qlick_segredos/{partidaId}`). Cai no deny-all das rules:
 * só o Admin SDK lê e grava.
 */
@Injectable()
export class QlickSegredoRepository extends FirestoreRepository<QlickSegredoEntity> {
  protected readonly collectionName = 'qlick_segredos';
  protected readonly entity: ClassConstructor<QlickSegredoEntity> =
    QlickSegredoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  /** Grava o cofre com o ID da partida (o `create` da base gera ID novo). */
  async gravar(partidaId: string, segredo: QlickSegredoEntity): Promise<void> {
    await this.collection.doc(partidaId).set(this.toPlain(segredo));
  }
}
