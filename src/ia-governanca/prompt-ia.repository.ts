import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { JogoIa } from '../professor/entities/professor.entity';
import { PromptIaEntity } from './entities/prompt-ia.entity';

/**
 * Acesso à coleção `prompts_ia`. O doc id **é o próprio jogo** (`qlick`/`wor`/
 * `isolateus`) — no máximo um prompt por jogo, então usamos `.doc(jogo)` em vez
 * de ids gerados (por isso não estende o `FirestoreRepository` genérico).
 */
@Injectable()
export class PromptIaRepository {
  private static readonly COLLECTION = 'prompts_ia';

  constructor(private readonly firebase: FirebaseService) {}

  private get col() {
    return this.firebase.firestore.collection(PromptIaRepository.COLLECTION);
  }

  async obter(jogo: JogoIa): Promise<PromptIaEntity | null> {
    const snap = await this.col.doc(jogo).get();
    return snap.exists
      ? plainToInstance(PromptIaEntity, { ...snap.data(), id: snap.id })
      : null;
  }

  async listar(): Promise<PromptIaEntity[]> {
    const snap = await this.col.get();
    return snap.docs.map((d) =>
      plainToInstance(PromptIaEntity, { ...d.data(), id: d.id }),
    );
  }

  async salvar(jogo: JogoIa, template: string): Promise<void> {
    await this.col.doc(jogo).set(
      { jogo, template, atualizadoEm: new Date().toISOString() },
      { merge: true },
    );
  }

  async remover(jogo: JogoIa): Promise<void> {
    await this.col.doc(jogo).delete();
  }
}
