import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { EntregaEntity } from './entities/entrega.entity';

/**
 * `entregas` (spec 038): fechada ao cliente. Id `{atividadeId}_{alunoId}`,
 * uma por aluno por atividade (#6).
 */
@Injectable()
export class EntregaRepository extends FirestoreRepository<EntregaEntity> {
  protected readonly collectionName = 'entregas';
  protected readonly entity: ClassConstructor<EntregaEntity> = EntregaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  ref(id: string): DocumentReference {
    return this.collection.doc(id);
  }

  /** Id para o arquivo antes de gravar (o upload já sabe o caminho). */
  novoArquivoId(): string {
    return this.collection.doc().id;
  }

  async lerNaTransacao(
    tx: Transaction,
    id: string,
  ): Promise<EntregaEntity | null> {
    const snap = await tx.get(this.ref(id));
    return snap.exists ? this.toEntity(snap.id, snap.data() ?? {}) : null;
  }

  gravarNaTransacao(tx: Transaction, e: EntregaEntity): void {
    const { id, ...dados } = e;
    tx.set(this.ref(id), this.toPlain(dados));
  }

  async daAtividade(atividadeId: string): Promise<EntregaEntity[]> {
    return this.findBy('atividadeId', atividadeId);
  }

  /** Entregas do aluno na turma (a lista do portal). */
  async doAluno(alunoId: string, turmaId: string): Promise<EntregaEntity[]> {
    return (await this.findBy('alunoId', alunoId)).filter(
      (e) => e.turmaId === turmaId,
    );
  }
}
