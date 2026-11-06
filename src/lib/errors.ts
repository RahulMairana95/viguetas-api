import { Response } from 'express';

// Error con código HTTP propio. Los controladores lo lanzan y lo capturan
// con responderError, que responde con el estado y el detalle correctos.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function responderError(res: Response, e: unknown) {
  if (e instanceof HttpError) {
    res.status(e.status).json({ message: e.message, ...e.extra });
    return;
  }
  console.error(e);
  res.status(500).json({ message: 'Error interno del servidor' });
}
