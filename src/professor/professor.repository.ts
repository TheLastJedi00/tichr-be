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

  /** Busca o professor dono de um `username` (para unicidade e portal). */
  async findByUsername(username: string): Promise<ProfessorEntity | null> {
    const snap = await this.firebase.firestore
      .collection('professores')
      .where('username', '==', username)
      .limit(1)
      .get();
    if (snap.empty) {
      return null;
    }
    const doc = snap.docs[0];
    return plainToInstance(ProfessorEntity, { ...doc.data(), uid: doc.id });
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
