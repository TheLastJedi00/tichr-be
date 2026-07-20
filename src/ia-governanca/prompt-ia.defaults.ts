import { JogoIa } from '../professor/entities/professor.entity';

/**
 * Templates default dos prompts de IA (fallback quando não há doc em `prompts_ia`).
 * São exatamente os textos que viviam hardcoded em cada `*IaService.montarPrompt`,
 * agora com tokens `{...}` para o admin poder ajustá-los pelo painel sem deploy.
 *
 * `{contexto}` recebe as linhas de disciplina/tópico já compostas — a própria
 * linha é removida quando fica vazia (ver {@link renderTemplate}).
 */
export const PROMPTS_DEFAULT: Record<JogoIa, string> = {
  qlick: [
    'Você cria quizzes de múltipla escolha em português do Brasil para uso em sala de aula.',
    '{contexto}',
    'Instruções do professor: {instrucao}',
    'Gere EXATAMENTE {qtdPerguntas} perguntas, cada uma com {qtdAlternativas} alternativas e APENAS uma correta.',
    'As perguntas devem ser claras e as alternativas plausíveis (sem "todas as anteriores").',
    'Responda SOMENTE com um array JSON, sem markdown, no formato:',
    '[{"enunciado":"...","alternativas":["a","b","c","d"],"corretaIndex":0}]',
    'onde corretaIndex é o índice (base 0) da alternativa correta.',
  ].join('\n'),

  wor: [
    'Você cria palavras secretas e dicas para um jogo de adivinhação (estilo forca) em português do Brasil, para uso em sala de aula.',
    '{contexto}',
    'Instruções do professor: {instrucao}',
    'Gere EXATAMENTE {qtdPalavras} palavras secretas, cada uma com {qtdDicas} dicas progressivas, da MAIS DIFÍCIL (1) para a MAIS FÁCIL (3).',
    'Cada palavra deve ser um termo único (sem espaços, acentos ou hífens), com no máximo 40 letras.',
    'As dicas NÃO podem conter a própria palavra secreta.',
    'Responda SOMENTE com um array JSON, sem markdown, no formato:',
    '[{"palavra":"GUILHOTINA","dicas":["dica 1","dica 2","dica 3"]}]',
  ].join('\n'),

  isolateus: [
    'Você cria questões de múltipla escolha em português do Brasil para uso em sala de aula.',
    'Elas serão usadas em um jogo de dedução (Tichr Isolateus) em que a turma defende os setores de uma vila isolada respondendo corretamente.',
    '{contexto}',
    'Instruções do professor: {instrucao}',
    'Gere EXATAMENTE {qtdQuestoes} questões, cada uma com {qtdAlternativas} alternativas e APENAS uma correta.',
    'O conteúdo deve ser rigorosamente pedagógico: a ambientação do jogo NÃO entra nas questões nem nas alternativas.',
    'As questões devem ser claras e as alternativas plausíveis (sem "todas as anteriores"), porque um infiltrado vai tentar convencer a turma a escolher uma alternativa errada.',
    'Responda SOMENTE com um array JSON, sem markdown, no formato:',
    '[{"enunciado":"...","alternativas":["a","b","c","d"],"corretaIndex":0}]',
    'onde corretaIndex é o índice (base 0) da alternativa correta.',
  ].join('\n'),
};

/**
 * Substitui os tokens `{chave}` do template pelos valores. Linhas que ficam
 * vazias após a substituição (ex.: `{contexto}` sem disciplina/tópico) são
 * removidas, para o prompt não ter linhas em branco pendentes.
 */
export function renderTemplate(
  template: string,
  tokens: Record<string, string | number | undefined>,
): string {
  let out = template;
  for (const [chave, valor] of Object.entries(tokens)) {
    out = out.split(`{${chave}}`).join(String(valor ?? ''));
  }
  return out
    .split('\n')
    .map((linha) => linha.trimEnd())
    .filter((linha) => linha.trim() !== '')
    .join('\n');
}
