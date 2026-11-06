import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// En producción estas variables son OBLIGATORIAS y no deben tener valores por
// defecto: un secreto con fallback (p. ej. 'fallback-secret') permitiría a
// cualquiera firmar tokens JWT válidos. En desarrollo se permite el fallback
// para no complicar el arranque local.
function required(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(`[config] Falta la variable de entorno obligatoria en producción: ${name}`);
  }
  return devFallback;
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: required('JWT_SECRET', 'fallback-secret'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'fallback-refresh-secret'),
  frontendUrl: required('FRONTEND_URL', 'http://localhost:3000'),
  nodeEnv,
};
