import { embaralhar } from '../common/shuffle.util';

/**
 * Bancos estáticos do Tichr Isolateus: os 6 setores da vila, os codinomes de
 * cidade distribuídos aos habitantes e as frases genéricas que alimentam o Chat
 * de Rumores e o debate da Quarentena.
 *
 * As frases são estáticas de propósito: chamar a IA a cada rodada multiplicaria
 * custo e latência e furaria o rate limit de 1×/dia. A IA fica exclusiva da
 * geração das questões (o conteúdo pedagógico, que é o que vale XP).
 */

/** Os 6 setores vitais da vila (§8: o total de 6 é a base do critério de vitória). */
export const SETORES: Array<{ id: string; nome: string }> = [
  { id: 'seguranca', nome: 'Setor de Segurança' },
  { id: 'comercio', nome: 'Setor de Comércio' },
  { id: 'medico', nome: 'Setor Médico' },
  { id: 'energia', nome: 'Setor de Energia' },
  { id: 'comunicacao', nome: 'Setor de Comunicação' },
  { id: 'abastecimento', nome: 'Setor de Abastecimento' },
];

/**
 * Os codinomes da vila: 99 cidades conhecidas do mundo.
 *
 * O aluno não escolhe mais o próprio nome — o Comando Central distribui um
 * codinome a **cada** habitante, real ou virtual. É o que mantém a Névoa de
 * Guerra intacta: se o aluno digitasse, a turma reconheceria o estilo de quem
 * escreveu e separaria os reais dos NPCs sem deduzir nada.
 */
export const NOMES_CIDADES: string[] = [
  // Ásia Oriental
  'Tóquio', 'Quioto', 'Osaka', 'Seul', 'Pequim', 'Xangai',
  'Hong Kong', 'Taipé', 'Bangkok', 'Hanói', 'Jacarta',
  // Sul e Sudeste Asiático
  'Manila', 'Singapura', 'Kuala Lumpur', 'Nova Délhi', 'Mumbai', 'Calcutá',
  'Colombo', 'Katmandu', 'Dacca', 'Karachi', 'Cabul',
  // Oriente Médio
  'Teerã', 'Bagdá', 'Damasco', 'Beirute', 'Jerusalém', 'Amã',
  'Dubai', 'Doha', 'Riade', 'Istambul', 'Ancara',
  // Sul da Europa
  'Atenas', 'Roma', 'Milão', 'Veneza', 'Nápoles', 'Madri',
  'Barcelona', 'Lisboa', 'Porto', 'Paris', 'Marselha',
  // Europa Central e Ocidental
  'Bruxelas', 'Amsterdã', 'Berlim', 'Munique', 'Hamburgo', 'Viena',
  'Zurique', 'Genebra', 'Praga', 'Budapeste', 'Varsóvia',
  // Leste Europeu e Bálcãs
  'Cracóvia', 'Bucareste', 'Sófia', 'Belgrado', 'Kiev', 'Moscou',
  'São Petersburgo', 'Helsinque', 'Estocolmo', 'Oslo', 'Copenhague',
  // Norte, Ilhas Britânicas e Norte da África
  'Reykjavík', 'Dublin', 'Londres', 'Edimburgo', 'Cairo', 'Alexandria',
  'Casablanca', 'Marrakech', 'Túnis', 'Argel', 'Trípoli',
  // África subsaariana e Oceania
  'Lagos', 'Acra', 'Nairóbi', 'Adis Abeba', 'Dacar', 'Joanesburgo',
  'Cidade do Cabo', 'Sydney', 'Melbourne', 'Auckland', 'Wellington',
  // Américas
  'Nova York', 'Chicago', 'Los Angeles', 'São Francisco', 'Toronto', 'Vancouver',
  'Cidade do México', 'Havana', 'Bogotá', 'Lima', 'Buenos Aires',
];

/** Ruído de fundo do Chat de Rumores durante a defesa de um setor. */
export const FRASES_NPC: string[] = [
  'Ouvi passos no telhado ontem à noite. Ninguém acredita em mim.',
  'As luzes voltaram a piscar sobre a floresta.',
  'Precisamos decidir rápido, o frio não espera.',
  'Alguém aqui não está sendo honesto.',
  'Eu vi alguém saindo da vila depois do toque de recolher.',
  'Não confio em quem fala demais.',
  'Fiquem calmos. O pânico é o que eles querem.',
  'Meu cão não para de latir para a mata.',
  'Se errarmos de novo, não sobra vila para salvar.',
  'Tem pegada estranha perto do rio congelado.',
  'Prefiro ficar calado. Falar chama atenção.',
  'Alguém mexeu nos meus mantimentos.',
  'A resposta parece óbvia demais. Cuidado.',
  'Eu durmo de olhos abertos desde terça.',
  'Não fui eu. Juro pela minha família.',
  'O silêncio lá fora está pior que o barulho.',
];

/** Frases curtas de acusação/defesa dos NPCs na Quarentena. */
export const FRASES_DEBATE_NPC: string[] = [
  'Ele mudou de ideia rápido demais na última votação.',
  'Estou vendo gente concordar com qualquer coisa.',
  'Não votem em mim. Eu defendi o setor.',
  'Quem espalhou aquele rumor devia explicar.',
  'Prefiro trancar alguém a perder mais uma noite.',
  'Isso é uma armadilha. Vão errar de novo.',
  'Eu confio em quem argumentou com lógica.',
  'Alguém aqui sabia a resposta e escondeu.',
];

/**
 * Sorteia `n` codinomes distintos para a vila.
 *
 * Falha alto se a vila passar do banco em vez de repetir ou sufixar nome: a
 * votação da Quarentena é feita **por nome na tela**, e dois habitantes
 * homônimos tornariam o voto ambíguo — melhor quebrar na criação da partida,
 * onde o professor vê o erro, do que no meio da apuração.
 */
export function sortearCodinomes(n: number): string[] {
  if (n > NOMES_CIDADES.length) {
    throw new Error(
      `A vila não comporta ${n} habitantes: o banco tem ${NOMES_CIDADES.length} codinomes.`,
    );
  }
  return embaralhar(NOMES_CIDADES).slice(0, n);
}
