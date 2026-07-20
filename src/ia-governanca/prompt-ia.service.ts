import { Injectable } from '@nestjs/common';
import { JogoIa } from '../professor/entities/professor.entity';
import { PromptIaEntity } from './entities/prompt-ia.entity';
import { PROMPTS_DEFAULT, renderTemplate } from './prompt-ia.defaults';
import { PromptIaRepository } from './prompt-ia.repository';

/** Contexto (disciplina/tópico) + instrução do professor para montar o prompt. */
export interface ContextoPrompt {
  disciplina?: string;
  topico?: string;
  instrucao: string;
  /** Contadores específicos do jogo (ex.: qtdPalavras, qtdDicas). */
  quantidades: Record<string, number>;
}

/** Um prompt para o painel admin: o que está salvo + o default (para "restaurar"). */
export interface PromptIaView {
  jogo: JogoIa;
  template: string;
  padrao: string;
  personalizado: boolean;
  atualizadoEm?: string;
}

/**
 * Governança dos prompts de IA. Os `*IaService` chamam {@link montar} para obter
 * o texto final (template do banco **ou** o default embutido, com os tokens já
 * substituídos). O painel admin usa o CRUD ({@link listar}/{@link salvar}/
 * {@link remover}).
 */
@Injectable()
export class PromptIaService {
  constructor(private readonly repo: PromptIaRepository) {}

  /** Monta o prompt final do `jogo`, resolvendo template + tokens. */
  async montar(jogo: JogoIa, ctx: ContextoPrompt): Promise<string> {
    const doc = await this.repo.obter(jogo);
    const template = doc?.template?.trim()
      ? doc.template
      : PROMPTS_DEFAULT[jogo];
    const contexto = [
      ctx.disciplina ? `Disciplina: ${ctx.disciplina}.` : '',
      ctx.topico ? `Tópico da aula: ${ctx.topico}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return renderTemplate(template, {
      contexto,
      instrucao: ctx.instrucao,
      ...ctx.quantidades,
    });
  }

  /** Lista os três jogos com o template vigente + o default (para o painel). */
  async listar(): Promise<PromptIaView[]> {
    const salvos = await this.repo.listar();
    const porJogo = new Map(salvos.map((p) => [p.jogo ?? p.id, p]));
    const jogos: JogoIa[] = ['qlick', 'wor', 'isolateus'];
    return jogos.map((jogo) => this.montarView(jogo, porJogo.get(jogo) ?? null));
  }

  async obter(jogo: JogoIa): Promise<PromptIaView> {
    return this.montarView(jogo, await this.repo.obter(jogo));
  }

  async salvar(jogo: JogoIa, template: string): Promise<PromptIaView> {
    await this.repo.salvar(jogo, template.trim());
    return this.obter(jogo);
  }

  /** Remove o override → o jogo volta a usar o template default embutido. */
  async remover(jogo: JogoIa): Promise<PromptIaView> {
    await this.repo.remover(jogo);
    return this.obter(jogo);
  }

  private montarView(jogo: JogoIa, doc: PromptIaEntity | null): PromptIaView {
    const padrao = PROMPTS_DEFAULT[jogo];
    const personalizado = !!doc?.template?.trim();
    return {
      jogo,
      template: personalizado ? doc!.template : padrao,
      padrao,
      personalizado,
      atualizadoEm: doc?.atualizadoEm,
    };
  }
}
