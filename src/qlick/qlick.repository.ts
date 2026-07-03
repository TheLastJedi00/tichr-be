import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { QlickEntity } from './entities/qlick.entity';

@Injectable()
export class QlickRepository extends FirestoreRepository<QlickEntity> {
  protected readonly collectionName = 'qlicks';
  protected readonly entity: ClassConstructor<QlickEntity> = QlickEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<QlickEntity[]> {
    return this.findBy('professorId', professorId);
  }
}
