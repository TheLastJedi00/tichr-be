import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { FeedbackEntity } from './entities/feedback.entity';

@Injectable()
export class FeedbackRepository extends FirestoreRepository<FeedbackEntity> {
  protected readonly collectionName = 'feedbacks';
  protected readonly entity: ClassConstructor<FeedbackEntity> = FeedbackEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  /**
   * Caixa de entrada do admin: mais novos primeiro. Ordena por `criadoEm`, que e
   * string ISO-8601 — a ordem lexicografica dela e a cronologica, entao o
   * Firestore resolve no indice simples, sem indice composto.
   */
  async listarRecentes(): Promise<FeedbackEntity[]> {
    const snap = await this.collection.orderBy('criadoEm', 'desc').get();
    return snap.docs.map((doc) => this.toEntity(doc.id, doc.data()));
  }
}
