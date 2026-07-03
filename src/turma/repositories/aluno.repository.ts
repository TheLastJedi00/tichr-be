import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { AlunoEntity } from '../entities/aluno.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class AlunoRepository extends FirestoreRepository<AlunoEntity> {
  protected readonly collectionName = 'alunos';
  protected readonly entity: ClassConstructor<AlunoEntity> = AlunoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByTurma(turmaId: string): Promise<AlunoEntity[]> {
    return this.findBy('turmaId', turmaId);
  }

  deleteByTurma(turmaId: string): Promise<void> {
    return this.deleteBy('turmaId', turmaId);
  }

  /** Vincula (ou desvincula, com null) o aluno a uma equipe. */
  definirEquipe(alunoId: string, equipeId: string | null): Promise<void> {
    return this.update(alunoId, { equipeId });
  }

  /** Devolve ao pool todos os alunos de uma equipe removida (equipeId -> null). */
  async limparEquipe(equipeId: string): Promise<void> {
    const snap = await this.collection.where('equipeId', '==', equipeId).get();
    if (snap.empty) {
      return;
    }
    const batch = this.firebase.firestore.batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { equipeId: null }));
    await batch.commit();
  }

  /** Define a lista de cargos de um aluno. */
  definirCargos(alunoId: string, cargoIds: string[]): Promise<void> {
    return this.update(alunoId, { cargoIds });
  }

  /** Remove um cargo (excluido) de todos os alunos da turma. */
  async limparCargo(turmaId: string, cargoId: string): Promise<void> {
    const alunos = await this.findByTurma(turmaId);
    const batch = this.firebase.firestore.batch();
    let algum = false;
    for (const aluno of alunos) {
      if (aluno.cargoIds?.includes(cargoId)) {
        algum = true;
        batch.update(this.collection.doc(aluno.id), {
          cargoIds: aluno.cargoIds.filter((c) => c !== cargoId),
        });
      }
    }
    if (algum) {
      await batch.commit();
    }
  }
}
