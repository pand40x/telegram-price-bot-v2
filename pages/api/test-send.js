import axios from 'axios';

// Telegram Bot API url'ini oluştur
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export default async function handler(req, res) {
  // Query parameter'dan chat_id al veya default değer kullan
  const chatId = req.query.chat_id || '1287479009';
  const message = req.query.message || 'Bu bir test mesajıdır!';
  
  console.log('Test message request:', { chatId, message });
  
  try {
    // Telegram API'ya mesaj gönder
    const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: message
    });
    
    console.log('Message sent successfully:', response.data);
    
    // Başarılı yanıt döndür
    return res.status(200).json({ 
      success: true, 
      message: `Message "${message}" sent to chat ${chatId}`,
      apiResponse: response.data
    });
  } catch (error) {
    console.error('Error sending message:', error.message);
    
    let errorData = { 
      message: error.message 
    };
    
    if (error.response) {
      errorData.data = error.response.data;
      errorData.status = error.response.status;
    }
    
    // Hata durumunda 500 döndür
    return res.status(500).json({ 
      success: false, 
      error: errorData
    });
  }
} 