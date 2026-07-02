import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { AlunoEntity } from '../entities/aluno.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class AlunoRepository extends FirestoreRepository<AlunoEntity> {
  protected readonly collectionName = 'alunos';
  protected readonly entity: ClassConstructor<AlunoEntity> = AlunoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByTurma(turmaId: string): Promise<AlunoEntity[]> {
    return this.findBy('turmaId', turmaId);
  }

  deleteByTurma(turmaId: string): Promise<void> {
    return this.deleteBy('turmaId', turmaId);
  }
}
