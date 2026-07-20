import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JogoIa } from '../professor/entities/professor.entity';
import { ConfigIaService } from './config-ia.service';
import { ConfigIaDto } from './dto/config-ia.dto';
import { SalvarPromptDto } from './dto/salvar-prompt.dto';
import { PromptIaService } from './prompt-ia.service';

const JOGOS_IA: JogoIa[] = ['qlick', 'wor', 'isolateus'];

/**
 * Governança de IA no backoffice (`/admin/ia`): CRUD dos prompts por jogo e o
 * limite global de gerações por dia. Restrito a administradores (AdminGuard).
 */
@UseGuards(AdminGuard)
@Controller('admin/ia')
export class AdminIaController {
  constructor(
    private readonly prompts: PromptIaService,
    private readonly config: ConfigIaService,
  ) {}

  // --- Prompts (Read/Update/Delete; não há "create" — os jogos são fixos) ---

  @Get('prompts')
  listarPrompts() {
    return this.prompts.listar();
  }

  @Get('prompts/:jogo')
  obterPrompt(@Param('jogo') jogo: string) {
    return this.prompts.obter(this.validarJogo(jogo));
  }

  @Put('prompts/:jogo')
  salvarPrompt(@Param('jogo') jogo: string, @Body() dto: SalvarPromptDto) {
    return this.prompts.salvar(this.validarJogo(jogo), dto.template);
  }

  /** Remove o override → volta ao template default embutido no código. */
  @Delete('prompts/:jogo')
  restaurarPrompt(@Param('jogo') jogo: string) {
    return this.prompts.remover(this.validarJogo(jogo));
  }

  // --- Configuração global (limite de gerações/dia) ---

  @Get('config')
  obterConfig() {
    return this.config.obter();
  }

  @Patch('config')
  atualizarConfig(@Body() dto: ConfigIaDto) {
    return this.config.definirLimite(dto.limiteGeracoesDia);
  }

  private validarJogo(jogo: string): JogoIa {
    if (!JOGOS_IA.includes(jogo as JogoIa)) {
      throw new BadRequestException(
        `Jogo inválido: ${jogo}. Use um de: ${JOGOS_IA.join(', ')}.`,
      );
    }
    return jogo as JogoIa;
  }
}
