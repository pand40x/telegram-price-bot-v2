import { VercelRequest, VercelResponse } from '@vercel/node';

export default async (req: VercelRequest, res: VercelResponse) => {
  console.log('Simple webhook called:', {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });

  // Telegram'a başarılı yanıt döndür
  res.status(200).json({ ok: true });
}; 