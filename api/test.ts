import { VercelRequest, VercelResponse } from '@vercel/node';

export default (req: VercelRequest, res: VercelResponse) => {
  res.status(200).json({
    status: 'ok',
    message: 'API çalışıyor!'
  });
}; 