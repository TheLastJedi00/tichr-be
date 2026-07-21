import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { FirestoreRepository } from '../../turma/repositories/firestore.repository';
import { InstituicaoEntity } from '../entities/instituicao.entity';

@Injectable()
export class InstituicaoRepository extends FirestoreRepository<InstituicaoEntity> {
  protected readonly collectionName = 'instituicoes';
  protected readonly entity: ClassConstructor<InstituicaoEntity> =
    InstituicaoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<InstituicaoEntity[]> {
    return this.findBy('professorId', professorId);
  }
}
