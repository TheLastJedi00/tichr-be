import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { SessaoAulaEntity } from '../entities/sessao-aula.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class SessaoRepository extends FirestoreRepository<SessaoAulaEntity> {
  protected readonly collectionName = 'sessoes';
  protected readonly entity: ClassConstructor<SessaoAulaEntity> =
    SessaoAulaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByTurma(turmaId: string): Promise<SessaoAulaEntity[]> {
    return this.findBy('turmaId', turmaId);
  }

  findByProfessor(professorId: string): Promise<SessaoAulaEntity[]> {
    return this.findBy('professorId', professorId);
  }

  deleteByTurma(turmaId: string): Promise<void> {
    return this.deleteBy('turmaId', turmaId);
  }
}
