import { Module } from '@nestjs/common';
import { InstituicaoController } from './instituicao.controller';
import { InstituicaoService } from './instituicao.service';
import { InstituicaoRepository } from './repositories/instituicao.repository';

/**
 * Ensino regular: cadastro de instituicoes (escolas) e geracao automatica da
 * grade horaria. Modulo independente; `FirebaseService` e global. Exporta o
 * repositorio para quem precisar validar posse de instituicao (ex.: turma).
 */
@Module({
  controllers: [InstituicaoController],
  providers: [InstituicaoService, InstituicaoRepository],
  exports: [InstituicaoRepository],
})
export class InstituicaoModule {}
