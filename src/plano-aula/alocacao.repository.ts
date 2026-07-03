import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { AlocacaoEntity } from './entities/alocacao.entity';

@Injectable()
export class AlocacaoRepository extends FirestoreRepository<AlocacaoEntity> {
  protected readonly collectionName = 'alocacoes';
  protected readonly entity: ClassConstructor<AlocacaoEntity> = AlocacaoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByTurma(turmaId: string): Promise<AlocacaoEntity[]> {
    return this.findBy('turmaId', turmaId);
  }

  /** Remove todas as alocacoes de um topico (usado ao excluir o topico). */
  deleteByTopico(topicoId: string): Promise<void> {
    return this.deleteBy('topicoId', topicoId);
  }
}
