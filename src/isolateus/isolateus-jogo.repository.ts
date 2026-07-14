import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { IsolateusJogoEntity } from './entities/isolateus-jogo.entity';

@Injectable()
export class IsolateusJogoRepository extends FirestoreRepository<IsolateusJogoEntity> {
  protected readonly collectionName = 'isolateus_jogos';
  protected readonly entity: ClassConstructor<IsolateusJogoEntity> =
    IsolateusJogoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<IsolateusJogoEntity[]> {
    return this.findBy('professorId', professorId);
  }
}
