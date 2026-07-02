import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { TurmaEntity } from '../entities/turma.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class TurmaRepository extends FirestoreRepository<TurmaEntity> {
  protected readonly collectionName = 'turmas';
  protected readonly entity: ClassConstructor<TurmaEntity> = TurmaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<TurmaEntity[]> {
    return this.findBy('professorId', professorId);
  }
}
