import { ClassConstructor, plainToInstance } from 'class-transformer';
import {
  CollectionReference,
  DocumentData,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../../firebase/firebase.service';

/**
 * Repositorio generico do Firestore.
 *
 * Regra de ouro: nunca devolve objetos literais para o Service — sempre
 * retorna instancias reais da entidade via class-transformer (plainToInstance).
 */
export abstract class FirestoreRepository<T extends { id: string }> {
  protected abstract readonly collectionName: string;
  protected abstract readonly entity: ClassConstructor<T>;

  constructor(protected readonly firebase: FirebaseService) {}

  protected get collection(): CollectionReference {
    return this.firebase.firestore.collection(this.collectionName);
  }

  protected toEntity(id: string, data: DocumentData): T {
    return plainToInstance(this.entity, { ...data, id });
  }

  async create(data: Omit<T, 'id'>): Promise<T> {
    const ref = await this.collection.add(data as DocumentData);
    return this.toEntity(ref.id, data as DocumentData);
  }

  async findById(id: string): Promise<T | null> {
    const snap = await this.collection.doc(id).get();
    return snap.exists ? this.toEntity(snap.id, snap.data()!) : null;
  }

  async findBy(field: string, value: unknown): Promise<T[]> {
    const snap = await this.collection.where(field, '==', value).get();
    return snap.docs.map((doc) => this.toEntity(doc.id, doc.data()));
  }

  async update(id: string, data: Partial<T>): Promise<void> {
    await this.collection.doc(id).update(data as DocumentData);
  }

  async delete(id: string): Promise<void> {
    await this.collection.doc(id).delete();
  }

  /** Apaga em lote todos os documentos onde field == value. */
  async deleteBy(field: string, value: unknown): Promise<void> {
    const snap = await this.collection.where(field, '==', value).get();
    if (snap.empty) {
      return;
    }
    const batch = this.firebase.firestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}
