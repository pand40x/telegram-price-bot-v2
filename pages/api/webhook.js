import axios from 'axios';

// Telegram Bot API url'ini oluştur
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// Komutu işle ve yanıt ver
async function processCommand(text, chatId) {
  console.log('Processing command:', { text, chatId });
  
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

  // Normal mesaj yanıtı (test için)
  if (!text.startsWith('/')) {
    return `Mesajınızı aldım: "${text}". Komut kullanmak için / ile başlayan mesajlar gönderin.`;
  }

  // Eğer mesaj bir komut ise
  if (text && text.startsWith('/')) {
    const command = text.split(' ')[0]; // İlk kelimeyi (komutu) al
    console.log('Command detected:', command);
    
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
  console.log('Sending message:', { chatId, text });
  
  try {
    const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
    
    console.log('Message sent successfully:', response.data);
    return true;
  } catch (error) {
    console.error('Error sending message:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    return false;
  }
}

export default async function handler(req, res) {
  // Log the request for debugging
  console.log('Webhook received request:', { 
    method: req.method, 
    headers: req.headers,
    body: req.body 
  });

  // POST isteklerini işle
  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      // Telegram update object kontrol
      if (!update) {
        console.error('Invalid update object received');
        return res.status(400).json({ ok: false, error: 'Invalid update object' });
      }
      
      // Mesaj varsa ve text içeriyorsa
      if (update.message && update.message.text) {
        const text = update.message.text;
        const chatId = update.message.chat.id;
        
        console.log('Received message:', { text, chatId, from: update.message.from });

        // Komutu işle
        const responseText = await processCommand(text, chatId);
        
        // Eğer bir yanıt varsa, gönder
        if (responseText) {
          const messageSent = await sendMessage(chatId, responseText);
          console.log('Message sending result:', { success: messageSent });
        }
      } else {
        console.log('Update contains no message or text:', update);
      }
      
      // Telegram'a başarılı yanıt döndür
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error processing webhook:', error);
      // Hata olsa bile Telegram'a 200 OK döndür (böylece tekrar denemeyi bırakır)
      return res.status(200).json({ ok: true, error: error.message });
    }
  }

  // GET istekleri için basit bir yanıt
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'active',
      message: 'Telegram webhook is active. Send POST requests with Telegram update objects.'
    });
  }

  // Diğer HTTP metodları için
  return res.status(405).json({ error: 'Method not allowed' });
} 