import type { Response } from 'express';

/**
 * Sends a private photo straight to the reader the service already
 * checked. Through `@Res()`, so the JSON interceptors leave the bytes
 * alone. `private`: a shared cache must never keep it, and the apps tell
 * a replaced photo apart by `photoVersion`, not by waiting this out.
 */
export function sendPrivateImage(res: Response, jpeg: Buffer): void {
  res
    .status(200)
    .set({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpeg.length),
      'Cache-Control': 'private, max-age=300',
    })
    .end(jpeg);
}
