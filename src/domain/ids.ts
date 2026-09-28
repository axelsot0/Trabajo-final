/** Identificador opaco para entidades internas. Nunca se deriva de datos de Meta o Telegram. */
export type Id = string;

export function newId(): Id {
  return crypto.randomUUID();
}
