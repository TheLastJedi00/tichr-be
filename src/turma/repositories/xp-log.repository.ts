import { Injectable } from '@nestjs/common';
import { ClassConstructor } from 'class-transformer';
import { FirebaseService } from '../../firebase/firebase.service';
import { XpLogEntity } from '../entities/xp-log.entity';
import { FirestoreRepository } from './firestore.repository';

@Injectable()
export class XpLogRepository extends FirestoreRepository<XpLogEntity> {
  protected readonly collectionName = 'xp_logs';
  protected readonly entity: ClassConstructor<XpLogEntity> = XpLogEntity;

  constructor(firebase: FirebaseService) {
    super(firebase);
  }

  findByAluno(alunoId: string): Promise<XpLogEntity[]> {
    return this.findBy('alunoId', alunoId);
  }
}
