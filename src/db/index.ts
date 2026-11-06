import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// En producción la base de datos es obligatoria: es mejor fallar al arrancar
// que levantar "funcionando" sin poder consultar nada.
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('[db] Falta la variable de entorno obligatoria en producción: DATABASE_URL');
}

export const client = postgres(process.env.DATABASE_URL!, { prepare: false });
export const db = drizzle(client, { schema });
