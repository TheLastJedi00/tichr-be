import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  App,
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: App;
  private db: Firestore;
  private bucketName: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const base64 = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT');

    if (!base64) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT nao configurada nas variaveis de ambiente.',
      );
    }

    const serviceAccount = JSON.parse(
      Buffer.from(base64, 'base64').toString('utf8'),
    ) as ServiceAccount & { project_id: string };

    // Buckets criados a partir de out/2024 usam o dominio `.firebasestorage.app`;
    // os legados usam `.appspot.com`. O env permite apontar o certo sem recompilar.
    this.bucketName =
      this.config.get<string>('FIREBASE_STORAGE_BUCKET') ??
      `${serviceAccount.project_id}.firebasestorage.app`;

    const existing = getApps();
    this.app =
      existing.length > 0
        ? existing[0]
        : initializeApp({
            credential: cert(serviceAccount),
            storageBucket: this.bucketName,
          });

    this.db = getFirestore(this.app);
    // Ignora campos undefined (ex.: totalAulas em GRADE_FIXA) na escrita.
    this.db.settings({ ignoreUndefinedProperties: true });
  }

  get firestore(): Firestore {
    return this.db;
  }

  get auth(): Auth {
    return getAuth(this.app);
  }

  /** Bucket padrao do Storage (Admin SDK — ignora as storage.rules). */
  get bucket() {
    return getStorage(this.app).bucket(this.bucketName);
  }
}
