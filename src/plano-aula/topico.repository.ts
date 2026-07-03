import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { TopicoEntity } from './entities/topico.entity';

@Injectable()
export class TopicoRepository extends FirestoreRepository<TopicoEntity> {
  protected readonly collectionName = 'topicos';
  protected readonly entity: ClassConstructor<TopicoEntity> = TopicoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  async findByDisciplina(
    professorId: string,
    disciplina: string,
  ): Promise<TopicoEntity[]> {
    const todos = await this.findBy('professorId', professorId);
    return todos.filter((t) => t.disciplina === disciplina);
  }
}
