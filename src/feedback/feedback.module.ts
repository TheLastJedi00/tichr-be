import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackRepository } from './feedback.repository';
import { FeedbackService } from './feedback.service';

/**
 * Canal de feedback do professor e triagem do admin.
 *
 * Sem `imports`: o FirebaseModule e `@Global()` e o ConfigModule e `isGlobal`,
 * entao o repositorio injeta o Firestore sem nada aqui (padrao do AdminModule).
 */
@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackRepository],
})
export class FeedbackModule {}
