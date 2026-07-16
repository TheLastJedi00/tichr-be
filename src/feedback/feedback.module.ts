import { Module } from '@nestjs/common';
import { FeedbackRepository } from './feedback.repository';

/**
 * Canal de feedback do professor e triagem do admin.
 *
 * Sem `imports`: o FirebaseModule e `@Global()` e o ConfigModule e `isGlobal`,
 * entao o repositorio injeta o Firestore sem nada aqui (padrao do AdminModule).
 */
@Module({
  providers: [FeedbackRepository],
})
export class FeedbackModule {}
