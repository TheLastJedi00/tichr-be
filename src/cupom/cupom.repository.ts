import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { CupomEntity } from './entities/cupom.entity';

@Injectable()
export class CupomRepository extends FirestoreRepository<CupomEntity> {
  protected readonly collectionName = 'cupons';
  protected readonly entity = CupomEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  /** Busca um cupom pelo codigo ja normalizado (maiUsculas). */
  async findByCodigo(codigo: string): Promise<CupomEntity | null> {
    const snap = await this.collection
      .where('codigo', '==', codigo)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return this.toEntity(doc.id, doc.data());
  }

  async listarTodos(): Promise<CupomEntity[]> {
    const snap = await this.collection.get();
    return snap.docs.map((d) => this.toEntity(d.id, d.data()));
  }
}
