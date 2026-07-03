import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { EquipeEntity } from '../entities/equipe.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class EquipeRepository extends FirestoreRepository<EquipeEntity> {
  protected readonly collectionName = 'equipes';
  protected readonly entity: ClassConstructor<EquipeEntity> = EquipeEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByTurma(turmaId: string): Promise<EquipeEntity[]> {
    return this.findBy('turmaId', turmaId);
  }
}
