import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { FeriasEntity } from '../entities/ferias.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class FeriasRepository extends FirestoreRepository<FeriasEntity> {
  protected readonly collectionName = 'ferias';
  protected readonly entity: ClassConstructor<FeriasEntity> = FeriasEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<FeriasEntity[]> {
    return this.findBy('professorId', professorId);
  }
}
