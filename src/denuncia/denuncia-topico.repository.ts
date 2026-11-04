import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { DenunciaTopicoEntity } from './entities/denuncia-topico.entity';

@Injectable()
export class DenunciaTopicoRepository extends FirestoreRepository<DenunciaTopicoEntity> {
  protected readonly collectionName = 'denuncia_topicos';
  protected readonly entity: ClassConstructor<DenunciaTopicoEntity> =
    DenunciaTopicoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }
}
