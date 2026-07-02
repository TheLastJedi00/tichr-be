import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { ExcecaoEntity } from '../entities/excecao.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class ExcecaoRepository extends FirestoreRepository<ExcecaoEntity> {
  protected readonly collectionName = 'excecoes';
  protected readonly entity: ClassConstructor<ExcecaoEntity> = ExcecaoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<ExcecaoEntity[]> {
    return this.findBy('professorId', professorId);
  }
}
