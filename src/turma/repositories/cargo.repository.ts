import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { CargoEntity } from '../entities/cargo.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class CargoRepository extends FirestoreRepository<CargoEntity> {
  protected readonly collectionName = 'cargos';
  protected readonly entity: ClassConstructor<CargoEntity> = CargoEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByTurma(turmaId: string): Promise<CargoEntity[]> {
    return this.findBy('turmaId', turmaId);
  }
}
