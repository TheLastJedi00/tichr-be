import { Module } from '@nestjs/common';
import { AdminIaController } from './admin-ia.controller';
import { ConfigIaService } from './config-ia.service';
import { PromptIaRepository } from './prompt-ia.repository';
import { PromptIaService } from './prompt-ia.service';

/**
 * Governança da IA: prompts editáveis (`prompts_ia`) e o limite global de
 * gerações por dia (`config/ia`). Exporta os serviços para os módulos de jogo
 * (Qlick/Wor/Isolateus) montarem o prompt e checarem o limite; o CRUD do painel
 * fica no {@link AdminIaController}. `FirebaseService` é global.
 */
@Module({
  controllers: [AdminIaController],
  providers: [PromptIaRepository, PromptIaService, ConfigIaService],
  exports: [PromptIaService, ConfigIaService],
})
export class IaGovernancaModule {}
