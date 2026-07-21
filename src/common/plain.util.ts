/**
 * Converte um valor em objeto/array **plano** (sem prototipo customizado),
 * removendo instancias de classe (ex.: DTOs criados via `new` pelo
 * class-transformer). O Firestore recusa objetos com prototipo proprio, entao
 * arrays aninhados de DTOs (turnos, intervalos, gradeHoraria...) precisam passar
 * por aqui antes de serem persistidos. So contem dados serializaveis (strings/
 * numeros/arrays), entao o round-trip por JSON e seguro.
 */
export function paraPlano<T>(valor: T): T {
  return valor === undefined || valor === null
    ? valor
    : (JSON.parse(JSON.stringify(valor)) as T);
}
