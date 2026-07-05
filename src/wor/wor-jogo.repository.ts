import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { WorJogoEntity } from './entities/wor-jogo.entity';

@Injectable()
export class WorJogoRepository extends FirestoreRepository<WorJogoEntity> {
  protected readonly collectionName = 'wor_jogos';
  protected readonly entity: ClassConstructor<WorJogoEntity> = WorJogoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<WorJogoEntity[]> {
    return this.findBy('professorId', professorId);
  }
}
