import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { hojeISO } from '../../common/date.util';
import { FirebaseService } from '../../firebase/firebase.service';
import { TurmaEntity } from '../entities/turma.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class TurmaRepository extends FirestoreRepository<TurmaEntity> {
  protected readonly collectionName = 'turmas';
  protected readonly entity: ClassConstructor<TurmaEntity> = TurmaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByProfessor(professorId: string): Promise<TurmaEntity[]> {
    return this.findBy('professorId', professorId);
  }

  /**
   * Conta as turmas que ocupam cota do plano: nao encerradas manualmente e com
   * cronograma vigente (regra encapsulada em `TurmaEntity.contaComoAtiva`).
   * Filtra em memoria para tolerar documentos legados sem o campo do flag.
   */
  async contarTurmasAtivas(professorId: string): Promise<number> {
    const turmas = await this.findByProfessor(professorId);
    const hoje = hojeISO();
    return turmas.filter((t) => t.contaComoAtiva(hoje)).length;
  }
}
