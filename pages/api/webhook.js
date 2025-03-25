export default function handler(req, res) {
  // Log the request body for debugging
  console.log('Webhook called:', {
    method: req.method,
    body: req.body,
  });

  // Send a 200 OK response to Telegram
  res.status(200).json({ ok: true });
} 