import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { PlanoAulaEntity } from './entities/plano-aula.entity';

@Injectable()
export class PlanoAulaRepository extends FirestoreRepository<PlanoAulaEntity> {
  protected readonly collectionName = 'planos_aula';
  protected readonly entity: ClassConstructor<PlanoAulaEntity> = PlanoAulaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<PlanoAulaEntity[]> {
    return this.findBy('professorId', professorId);
  }

  async findByDisciplina(
    professorId: string,
    disciplina: string,
  ): Promise<PlanoAulaEntity | null> {
    const todos = await this.findByProfessor(professorId);
    return todos.find((p) => p.disciplina === disciplina) ?? null;
  }
}
