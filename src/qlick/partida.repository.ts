import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { reivindicarEntrada } from '../common/entrada';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreRepository } from '../turma/repositories/firestore.repository';
import { PartidaEntity } from './entities/partida.entity';

@Injectable()
export class PartidaRepository extends FirestoreRepository<PartidaEntity> {
  protected readonly collectionName = 'qlick_partidas';
  protected readonly entity: ClassConstructor<PartidaEntity> = PartidaEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByTurma(turmaId: string): Promise<PartidaEntity[]> {
    return this.findBy('turmaId', turmaId);
  }

  /** Quem ganha o início pelo cronômetro de entrada (035), em transação. */
  reivindicarEntrada(id: string, agora: number): Promise<boolean> {
    return reivindicarEntrada(
      this.firebase.firestore,
      this.collection.doc(id),
      agora,
    );
  }
}
