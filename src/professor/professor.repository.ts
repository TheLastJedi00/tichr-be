import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { FirebaseService } from '../firebase/firebase.service';
import { ProfessorEntity } from './entities/professor.entity';

/**
 * Repositorio do perfil. Diferente dos demais, usa o uid como id do documento
 * (`professores/{uid}`) e faz upsert com merge.
 */
@Injectable()
export class ProfessorRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private doc(uid: string) {
    return this.firebase.firestore.collection('professores').doc(uid);
  }

  async findByUid(uid: string): Promise<ProfessorEntity | null> {
    const snap = await this.doc(uid).get();
    if (!snap.exists) {
      return null;
    }
    return plainToInstance(ProfessorEntity, { ...snap.data(), uid });
  }

  async upsert(
    uid: string,
    data: Partial<ProfessorEntity>,
  ): Promise<ProfessorEntity> {
    const plain = { ...data };
    delete plain.uid;
    await this.doc(uid).set(plain, { merge: true });
    return (await this.findByUid(uid))!;
  }
}
