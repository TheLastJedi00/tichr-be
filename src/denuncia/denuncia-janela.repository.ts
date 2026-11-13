import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { DenunciaJanelaEntity } from './entities/denuncia-janela.entity';

/** `denuncia_janelas`: fechada ao cliente, como o resto da denúncia. */
@Injectable()
export class DenunciaJanelaRepository extends FirestoreRepository<DenunciaJanelaEntity> {
  protected readonly collectionName = 'denuncia_janelas';
  protected readonly entity: ClassConstructor<DenunciaJanelaEntity> =
    DenunciaJanelaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }
}
