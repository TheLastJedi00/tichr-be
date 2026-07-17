import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { CobrancaEntity } from './entities/cobranca.entity';

/**
 * Repositorio das cobrancas (colecao `cobrancas`, **server-only** — o cliente
 * nunca le). Diferente do base: o `id` do documento e o id da cobranca no
 * gateway, entao a criacao usa `set(id)` em vez do `add()` com id automatico.
 */
@Injectable()
export class CobrancaRepository extends FirestoreRepository<CobrancaEntity> {
  protected readonly collectionName = 'cobrancas';
  protected readonly entity = CobrancaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  /** Cria/sobrescreve a cobranca com o id do gateway. */
  async salvar(cobranca: CobrancaEntity): Promise<CobrancaEntity> {
    await this.collection.doc(cobranca.id).set(this.toPlain(cobranca));
    return cobranca;
  }
}
