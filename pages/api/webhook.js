import axios from 'axios';

// Telegram Bot API url'ini oluştur
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Komutu işle ve yanıt ver
async function processCommand(text, chatId) {
  // Komutları ve yanıtları tanımla
  const commands = {
    '/l': 'Yeni liste oluşturmak için bir isim girin.',
    '/liste': 'Yeni liste oluşturmak için bir isim girin.',
    '/ekle': 'Listeye sembol eklemek için liste adı ve sembolleri girin.',
    '/add': 'Listeye sembol eklemek için liste adı ve sembolleri girin.',
    '/cikar': 'Listeden sembol çıkarmak için liste adı ve sembolleri girin.',
    '/listeler': 'İşte mevcut listeleriniz...',
    '/lists': 'İşte mevcut listeleriniz...',
    '/listedetay': 'Liste detaylarını görmek için liste adını girin.',
    '/listesil': 'Listeyi silmek için liste adını girin.',
    '/fiyat': 'Liste için fiyatları göstermek için liste adını girin.',
    '/price': 'Liste için fiyatları göstermek için liste adını girin.',
    '/uyari': 'Uyarı listesi oluşturmak için bir isim girin.',
    '/alarm': 'Uyarı listesi oluşturmak için bir isim girin.',
    '/uyarilisteler': 'İşte mevcut uyarı listeleriniz...',
    '/alarmlisteler': 'İşte mevcut uyarı listeleriniz...',
    '/help': 'Kullanılabilir komutlar: /liste, /ekle, /cikar, /listeler, /fiyat, /uyari, /help, /start',
    '/start': 'Hoş geldiniz! Kullanılabilir komutlar: /liste, /ekle, /cikar, /listeler, /fiyat, /uyari, /help'
  };

  // Eğer mesaj bir komut ise
  if (text && text.startsWith('/')) {
    const command = text.split(' ')[0]; // İlk kelimeyi (komutu) al
    
    if (commands[command]) {
      return commands[command];
    } else {
      return 'Bilinmeyen komut. Yardım için /help yazın.';
    }
  }
  
  // Komut değilse boş string döndür
  return '';
}

// Telegram'a mesaj gönder
async function sendMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

export default async function handler(req, res) {
  // Log the request body for debugging
  console.log('Webhook called:', {
    method: req.method,
    body: req.body,
  });

  // POST isteklerini işle
  if (req.method === 'POST') {
    const { message } = req.body;
    
    // Mesaj varsa ve text içeriyorsa
    if (message && message.text) {
      const text = message.text;
      const chatId = message.chat.id;

      // Komutu işle
      const responseText = await processCommand(text, chatId);
      
      // Eğer bir yanıt varsa, gönder
      if (responseText) {
        await sendMessage(chatId, responseText);
      }
    }
  }

  // Telegram'a başarılı yanıt döndür
  res.status(200).json({ ok: true });
} 