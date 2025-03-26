import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectBot, Start, Help, Command, On, Ctx, Update, Action } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';
import { CmcService } from '../cmc/cmc.service';
import { PriceService } from '../price/price.service';
import { SymbolService, SymbolSearchResult } from '../symbol/symbol.service';
import { BinanceService } from '../binance/binance.service';
import { AlertService } from '../alert/alert.service';
import { AssetPrice } from '../price/interfaces/price.interface';

@Update()
@Injectable()
export class BotUpdate implements OnModuleInit {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly cmcService: CmcService,
    private readonly priceService: PriceService,
    private readonly symbolService: SymbolService,
    private readonly binanceService: BinanceService,
    private readonly alertService: AlertService,
    @InjectBot() private bot: Telegraf,
  ) {
    this.logger.log('BotUpdate initialized - tüm komutlar yapılandırılıyor');
    
    // Manuel olarak çalışan komutlar ekleyelim - gruplarda da çalışmasını sağlamak için
    this.bot.command(['listeler', 'lists'], async (ctx) => {
      this.logger.debug('listeler/lists komutu manuel çağrıldı');
      await this.showUserLists(ctx, ctx.from.id.toString());
    });
    
    this.bot.command(['fiyat', 'price'], async (ctx) => {
      this.logger.debug('fiyat/price komutu manuel çağrıldı');
      await this.getSmartPrices(ctx);
    });
    
    // Uyarı komutları
    this.bot.command(['alerts', 'uyarilisteler', 'alarmlisteler'], async (ctx) => {
      this.logger.debug('alerts/uyarilisteler/alarmlisteler komutu manuel çağrıldı');
      try {
        await this.handleAlertCommand(ctx);
      } catch (error) {
        this.logger.error('Alerts komutu hatası:', error);
        await ctx.reply('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      }
    });

    this.bot.command('alertsadd', async (ctx) => {
      console.log('ALERTSADD KOMUTU ÇALIŞTIRILDI!');
      try {
        if (!ctx.message) return;
        
        const chatId = ctx.message.chat.id.toString();
        const messageText = (ctx.message as any)?.text || '';
        
        // Komutu parçalara ayır (/alertsadd liste_adı sembol)
        const parts = messageText.split(' ').filter(p => p.trim() !== '');
        
        // Eğer sadece komut varsa (parametre yoksa) veya çok az parametre varsa
        if (parts.length < 2) {
          await ctx.reply(
            'Lütfen bir liste adı ve en az bir sembol belirtin.\n' +
            'Örnek: /alertsadd kripto BTC\n' +
            'Çoklu sembol: /alertsadd kripto BTC ETH PEPE\n' +
            'Farklı eşikler: /alertsadd kripto BTC 1 ETH 3 PEPE 5'
          );
          return;
        }
        
        // Liste adı eksik olabilir mi? İlk parametrenin sembol olup olmadığını kontrol et
        const firstParam = parts[1].toUpperCase();
        
        // Yaygın kripto, hisse senedi sembolleri ve diğer sembol formatları
        const cryptoSymbols = ['BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'ADA', 'AVAX', 'DOGE', 'PEPE', 'SHIB', 'BNB', 'MATIC'];
        const stockSymbols = [
          // Türk hisseleri - BIST
          'THYAO', 'ASELS', 'KCHOL', 'SISE', 'GARAN', 'AKBNK', 'TUPRS', 'BIMAS', 'FROTO', 'EREGL', 'YKBNK',
          'PGSUS', 'TAVHL', 'TCELL', 'SAHOL', 'HEKTS', 'VESTL', 'TTKOM', 'DOHOL', 'KRDMD', 'PETKM', 
          'EKGYO', 'TOASO', 'SASA', 'ARCLK', 'KOZAA', 'KOZAL', 'MAVI', 'ISCTR', 'ODAS', 'ALFAS',
          // Yabancı hisseler
          'AAPL', 'MSFT', 'AMZN', 'GOOG', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'WMT', 'JNJ', 'PG', 'BABA',
          'XOM', 'DIS', 'NFLX', 'UBER', 'INTC', 'IBM', 'F', 'GM', 'AMD', 'MCD', 'KO', 'PEP', 'NKE'
        ];
        const isStockFormat = firstParam.includes('.') || firstParam.includes('-') || /XU\d+/.test(firstParam);
        
        // İlk parametre bir sembol olabilir mi?
        const firstParamIsSymbol = cryptoSymbols.includes(firstParam) || 
                                   stockSymbols.includes(firstParam) || 
                                   isStockFormat || 
                                   /^[A-Z0-9]{1,10}$/.test(firstParam);
        
        // İlk parametre sayı değil ve sembol formatına uygun mu?
        const isFirstParamPossiblySymbol = isNaN(parseFloat(firstParam)) && firstParamIsSymbol;
        
        // İkinci parametre sayı mı? (eşik değeri olabilir)
        const secondParamIsPossiblyThreshold = parts.length > 2 && !isNaN(parseFloat(parts[2]));
        
        // Listenin zaten var olup olmadığını kontrol etmek için mevcut listeleri al
        const userAlertLists = await this.alertService.getUserAlertLists(chatId);
        const existingListNames = userAlertLists.map(list => list.listName.toLowerCase());
        const hasKriptoList = existingListNames.includes('kripto');
        const hasBorsaList = existingListNames.includes('borsa');
        
        let listName: string;
        let remainingParts: string[];
        
        // Liste adı eksik gibi görünüyor mu?
        if (isFirstParamPossiblySymbol && (parts.length === 2 || secondParamIsPossiblyThreshold)) {
          // İlk parametre bir sembol gibi görünüyor, liste adı eksik
          
          // Sembol tipine göre önerilen liste
          const isStock = stockSymbols.includes(firstParam) || isStockFormat;
          const suggestedListName = isStock ? 'borsa' : 'kripto';
          
          // Kullanıcıya hata ve öneri mesajı
          const suggestionButtons = [];
          
          // "kripto" veya "borsa" listesi zaten varsa, o listeye ekleme seçeneği sun
          if (isStock && hasBorsaList) {
            suggestionButtons.push(
              Markup.button.callback('➕ "borsa" listesine ekle', `add_to_alert_list:borsa:${parts.slice(1).join(',')}:${chatId}`)
            );
          } else if (!isStock && hasKriptoList) {
            suggestionButtons.push(
              Markup.button.callback('➕ "kripto" listesine ekle', `add_to_alert_list:kripto:${parts.slice(1).join(',')}:${chatId}`)
            );
          } else {
            // Liste yoksa, oluşturma seçeneği sun
            suggestionButtons.push(
              Markup.button.callback(`✨ "${suggestedListName}" listesi oluştur`, `create_quick_list:${suggestedListName}:${firstParam}:${chatId}`)
            );
          }
          
          const keyboard = Markup.inlineKeyboard(suggestionButtons);
          
          // Kullanıcıya bilgilendirme mesajı
          let hintMessage = 'Liste adı eksik görünüyor. ';
          
          if (secondParamIsPossiblyThreshold) {
            hintMessage += `"${firstParam}" için %${parts[2]} eşiği ile uyarı mı oluşturmak istiyorsunuz?`;
          } else {
            hintMessage += `"${firstParam}" sembolünü bir uyarı listesine mi eklemek istiyorsunuz?`;
          }
          
          // Sembol tipine göre ek bilgi
          if (isStock) {
            hintMessage += `\n\n📈 ${firstParam} bir hisse senedi sembolüne benziyor.`;
          } else {
            hintMessage += `\n\n🔹 ${firstParam} bir kripto para sembolüne benziyor.`;
          }
          
          await ctx.reply(hintMessage, keyboard);
          return;
        } else {
          // Normal durum, kullanıcı liste adı belirtmiş
          listName = parts[1].toLowerCase();
          remainingParts = parts.slice(2);
          
          // Eğer liste adı "kripto" veya "borsa" değilse ve kullanıcı özel bir liste adı kullanmak istiyorsa
          if (listName !== 'kripto' && listName !== 'borsa' && remainingParts.length > 0) {
            // İlk sembolü analiz et
            const firstSymbol = remainingParts[0].toUpperCase();
            const isStock = stockSymbols.includes(firstSymbol) || isStockFormat;
            
            // Sembol tipine göre önerilen standart liste
            const suggestedListName = isStock ? 'borsa' : 'kripto';
            
            // Bu liste zaten var mı?
            const listExists = await this.alertService.doesAlertListExist(chatId, listName);
            
            if (!listExists) {
              // Önerilen standart liste zaten var mı?
              const standardListExists = await this.alertService.doesAlertListExist(chatId, suggestedListName);
              
              const buttons = [];
              
              // Kullanıcının istediği liste adını oluştur seçeneği
              buttons.push(
                Markup.button.callback(`✅ "${listName}" listesi oluştur`, `create_quick_list:${listName}:${firstSymbol}:${chatId}`)
              );
              
              // Standart liste önerisi
              if (standardListExists) {
                // Standart liste varsa, ona ekleme seçeneği
                buttons.push(
                  Markup.button.callback(`➕ "${suggestedListName}" listesine ekle`, `add_to_alert_list:${suggestedListName}:${remainingParts.join(',')}:${chatId}`)
                );
              } else {
                // Standart liste yoksa, onu oluşturma seçeneği
                buttons.push(
                  Markup.button.callback(`🔄 "${suggestedListName}" listesi oluştur`, `create_quick_list:${suggestedListName}:${firstSymbol}:${chatId}`)
                );
              }
              
              const keyboard = Markup.inlineKeyboard(buttons);
              
              // Bilgilendirme mesajı
              let message = `"${listName}" uyarı listesi bulunamadı.\n\n`;
              
              // Sembol tipi bilgisi
              if (isStock) {
                message += `📈 ${firstSymbol} bir hisse senedi sembolüne benziyor. Standart "borsa" listesini kullanmak isteyebilirsiniz.\n`;
              } else {
                message += `🔹 ${firstSymbol} bir kripto para sembolüne benziyor. Standart "kripto" listesini kullanmak isteyebilirsiniz.\n`;
              }
              
              message += `${remainingParts.join(', ')} sembollerini eklemek için seçim yapabilirsiniz:`;
              
              await ctx.reply(message, keyboard);
              return;
            }
          }
        }
        
        // Normal işleme devam et (liste adı ve semboller belirtilmiş)
        // Başarıyla eklenen semboller
        const addedSymbols: { symbol: string, threshold: number }[] = [];
        
        // 1. Senaryo: /alertsadd kripto btc 1 pepe 3 eth 5
        if (remainingParts.length >= 2 && !isNaN(parseFloat(remainingParts[1]))) {
          // Sembol-eşik çiftleri olarak işle
          for (let i = 0; i < remainingParts.length; i += 2) {
            const symbol = remainingParts[i].toUpperCase();
            
            // Eğer bir sonraki parametre sayı değilse, varsayılan eşik kullan
            let threshold = 5;
            if (i + 1 < remainingParts.length && !isNaN(parseFloat(remainingParts[i + 1]))) {
              threshold = parseFloat(remainingParts[i + 1]);
            } else {
              // Sayı değilse bir sonraki elemanı bir sembol olarak ele al
              i--; // Sayaç artışını dengele
            }
            
            const success = await this.alertService.addSymbolToAlertList(
              chatId, 
              listName, 
              symbol, 
              threshold
            );
            
            if (success) {
              addedSymbols.push({ symbol, threshold });
            }
          }
        } 
        // 2. Senaryo: /alertsadd kripto btc eth pepe
        else {
          // Tüm parametreleri sembol olarak kabul et ve varsayılan eşik kullan
          for (const symbolParam of remainingParts) {
            const symbol = symbolParam.toUpperCase();
            const success = await this.alertService.addSymbolToAlertList(
              chatId, 
              listName, 
              symbol, 
              5 // Varsayılan eşik değeri
            );
            
            if (success) {
              addedSymbols.push({ symbol, threshold: 5 });
            }
          }
        }
        
        if (addedSymbols.length > 0) {
          const symbolInfos = addedSymbols.map(item => `${item.symbol} (Eşik: %${item.threshold})`);
          await ctx.reply(
            `"${listName}" uyarı listesine eklenen semboller:\n\n${symbolInfos.join('\n')}`
          );
        } else {
          // Liste bulunamadı veya semboller eklenemedi
          // Yeni bir liste oluşturmayı öner
          
          // İlk sembole göre türü tahmin et (kripto veya borsa)
          const firstSymbol = remainingParts[0].toUpperCase();
          
          // Sembol tipini belirle - Yaygın borsa kodları için kontrol listesi
          const stockSymbols = [
            // Türk hisseleri - BIST
            'THYAO', 'ASELS', 'KCHOL', 'SISE', 'GARAN', 'AKBNK', 'TUPRS', 'BIMAS', 'FROTO', 'EREGL', 'YKBNK',
            'PGSUS', 'TAVHL', 'TCELL', 'SAHOL', 'HEKTS', 'VESTL', 'TTKOM', 'DOHOL', 'KRDMD', 'PETKM', 
            'EKGYO', 'TOASO', 'SASA', 'ARCLK', 'KOZAA', 'KOZAL', 'MAVI', 'ISCTR', 'ODAS', 'ALFAS',
            // Yabancı hisseler
            'AAPL', 'MSFT', 'AMZN', 'GOOG', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'WMT', 'JNJ', 'PG', 'BABA',
            'XOM', 'DIS', 'NFLX', 'UBER', 'INTC', 'IBM', 'F', 'GM', 'AMD', 'MCD', 'KO', 'PEP', 'NKE'
          ];
          
          // Kripto para birimleri listesi
          const cryptoSymbols = [
            'BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'ADA', 'AVAX', 'DOGE', 'PEPE', 'SHIB', 'BNB', 'MATIC', 
            'LINK', 'LTC', 'DOT', 'UNI', 'ATOM', 'XLM', 'TRX', 'DAI', 'BCH', 'USDC', 'USDT', 'CAKE'
          ];
          
          // Sembol formatına göre tip belirle
          const isStockByFormat = firstSymbol.includes('.') || firstSymbol.includes('-') || /XU\d+/.test(firstSymbol);
          
          // Sembol yaygın borsa veya kripto listelerinde var mı kontrol et
          const isStock = stockSymbols.includes(firstSymbol) || isStockByFormat;
          const isCrypto = cryptoSymbols.includes(firstSymbol);
          
          // Kullanıcının belirttiği liste adı
          const specifiedListName = listName.toLowerCase();
          
          // Önerilen liste adı - bu sembol için uygun olan liste
          const suggestedListName = isStock ? 'Borsa' : 'Kripto';
          
          // Mevcut listeleri kontrol et
          const existingLists = await this.symbolService.getUserLists(ctx.from.id.toString());
          const hasKriptoList = existingLists.some(l => l.listName.toLowerCase() === 'kripto');
          const hasBorsaList = existingLists.some(l => l.listName.toLowerCase() === 'borsa');
          
          // Sembol tipine uygun liste zaten varsa, onu öner
          let preferredListName = '';
          if (isStock && hasBorsaList) {
            preferredListName = 'Borsa';
          } else if (isCrypto && hasKriptoList) {
            preferredListName = 'Kripto';
          }
          
          // Butonlar
          const buttons = [];
          
          // Kullanıcının istediği liste adı ile buton ekle
          buttons.push(
            Markup.button.callback(`✅ "${listName}" listesi oluştur`, `create_symbol_list:${listName}:${firstSymbol}:${ctx.from.id.toString()}`)
          );
          
          // Eğer önerilen liste adı farklıysa ve mevcut değilse ona da buton ekle
          if (suggestedListName.toLowerCase() !== listName.toLowerCase()) {
            buttons.push(
              Markup.button.callback(`🔄 "${suggestedListName}" listesi oluştur`, `create_symbol_list:${suggestedListName}:${firstSymbol}:${ctx.from.id.toString()}`)
            );
          }
          
          // Eğer tercih edilen liste varsa, sembolleri ona eklemek için buton ekle
          if (preferredListName && preferredListName.toLowerCase() !== listName.toLowerCase()) {
            buttons.push(
              Markup.button.callback(`➕ "${preferredListName}" listesine ekle`, `add_to_list:${preferredListName}:${remainingParts.join(',')}:${ctx.from.id.toString()}`)
            );
          }
          
          // Inline klavye oluştur
          const keyboard = Markup.inlineKeyboard(buttons);
          
          let responseMessage = `"${listName}" adında bir listeniz yok.\n\n`;
          
          // Sembol tipi bilgisi ekle
          if (isStock) {
            responseMessage += `📈 ${firstSymbol} bir hisse senedi sembolüne benziyor.\n`;
          } else if (isCrypto) {
            responseMessage += `🔹 ${firstSymbol} bir kripto para sembolüne benziyor.\n`;
          }
          
          responseMessage += `${remainingParts.join(', ')} sembollerini eklemek için önce bir liste oluşturmalısınız.`;
          
          await ctx.reply(responseMessage, keyboard);
          return;
        }
      } catch (error) {
        console.error('Alertsadd komutu hatası:', error);
        await ctx.reply('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      }
    });

    this.bot.command('alertremove', async (ctx) => {
      console.log('ALERTREMOVE KOMUTU ÇALIŞTIRILDI!');
      try {
        if (!ctx.message) return;
        
        const chatId = ctx.message.chat.id.toString();
        const messageText = (ctx.message as any)?.text || '';
        
        // Komutu parçalara ayır (/alertremove liste_adı sembol)
        const parts = messageText.split(' ');
        
        if (parts.length < 3) {
          await ctx.reply(
            'Lütfen bir liste adı ve sembol belirtin.\n' +
            'Örnek: /alertremove kripto BTC'
          );
          return;
        }
        
        const listName = parts[1];
        const symbolQuery = parts[2].toUpperCase();
        
        // Sembolü listeden çıkar
        const success = await this.alertService.removeSymbolFromAlertList(chatId, listName, symbolQuery);
        
        if (success) {
          await ctx.reply(`"${symbolQuery}" sembolü "${listName}" uyarı listesinden çıkarıldı.`);
        } else {
          await ctx.reply(`"${symbolQuery}" sembolü uyarı listesinden çıkarılamadı. Liste veya sembol bulunamadı.`);
        }
      } catch (error) {
        console.error('Alertremove komutu hatası:', error);
        await ctx.reply('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      }
    });

    this.bot.command('alertrmv', async (ctx) => {
      console.log('ALERTRMV KOMUTU ÇALIŞTIRILDI!');
      try {
        if (!ctx.message) return;
        
        const chatId = ctx.message.chat.id.toString();
        const messageText = (ctx.message as any)?.text || '';
        
        // Komutu parçalara ayır (/alertremove liste_adı sembol)
        const parts = messageText.split(' ');
        
        if (parts.length < 3) {
          await ctx.reply(
            'Lütfen bir liste adı ve sembol belirtin.\n' +
            'Örnek: /alertrmv kripto BTC'
          );
          return;
        }
        
        const listName = parts[1];
        const symbolQuery = parts[2].toUpperCase();
        
        // Sembolü listeden çıkar
        const success = await this.alertService.removeSymbolFromAlertList(chatId, listName, symbolQuery);
        
        if (success) {
          await ctx.reply(`"${symbolQuery}" sembolü "${listName}" uyarı listesinden çıkarıldı.`);
        } else {
          await ctx.reply(`"${symbolQuery}" sembolü uyarı listesinden çıkarılamadı. Liste veya sembol bulunamadı.`);
        }
      } catch (error) {
        console.error('Alertrmv komutu hatası:', error);
        await ctx.reply('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      }
    });
    
    // Manuel olarak Alert callbackleri tanımla
    this.bot.action(/alert_symbol:(.+):(.+):(.+)/, async (ctx) => {
      console.log('ALERT SYMBOL CALLBACK ÇALIŞTIRILDI!');
      try {
        await this.handleAlertSymbolSelection(ctx);
      } catch (error) {
        console.error('Alert callback hatası:', error);
      }
    });
    
    // Hızlı liste oluşturma callbacklerini tanımla
    this.bot.action(/create_quick_list:(.+):(.+):(.+)/, async (ctx) => {
      console.log('HIZLI UYARI LİSTESİ OLUŞTURMA CALLBACK ÇALIŞTIRILDI!');
      try {
        await this.handleQuickListCreation(ctx);
      } catch (error) {
        console.error('Hızlı liste oluşturma callback hatası:', error);
      }
    });
    
    // Sembol listesi oluşturma callbacklerini tanımla
    this.bot.action(/create_symbol_list:(.+):(.+):(.+)/, async (ctx) => {
      console.log('SEMBOL LİSTESİ OLUŞTURMA CALLBACK ÇALIŞTIRILDI!');
      try {
        await this.handleSymbolListCreation(ctx);
      } catch (error) {
        console.error('Sembol listesi oluşturma callback hatası:', error);
      }
    });
    
    // Test komutu
    this.bot.command('ualert', async (ctx) => {
      console.log('UALERT KOMUTU ÇALIŞTIRILDI!');
      try {
        await ctx.reply('Uyarı komutu alternatif yöntemle çalıştırıldı!');
      } catch (error) {
        console.error('Uyarı komutu hatası:', error);
      }
    });

    // Liste komutlarını da manuel olarak tanımlayalım
    this.bot.command(['l', 'liste'], async (ctx) => {
      this.logger.debug('l/liste komutu manuel çağrıldı');
      try {
        await this.handleLists(ctx);
      } catch (error) {
        this.logger.error('Liste komutu hatası:', error);
      }
    });
    
    this.bot.command(['ekle', 'add'], async (ctx) => {
      this.logger.debug('ekle/add komutu manuel çağrıldı');
      try {
        await this.addToList(ctx);
      } catch (error) {
        this.logger.error('Ekle komutu hatası:', error);
      }
    });
    
    this.bot.command(['cikar', 'çıkar', 'remove'], async (ctx) => {
      this.logger.debug('cikar/çıkar/remove komutu manuel çağrıldı');
      try {
        await this.handleCikarCommandAscii(ctx);
      } catch (error) {
        this.logger.error('Çıkar komutu hatası:', error);
      }
    });

    this.bot.command(['listedetay', 'listdetail'], async (ctx) => {
      this.logger.debug('listedetay/listdetail komutu manuel çağrıldı');
      try {
        const userId = ctx.from.id.toString();
        const message = ctx.message;
        const text = 'text' in message ? message.text : '';
        const args = text.split(' ').slice(1);
        
        if (args.length < 1) {
          await ctx.reply('Kullanım: /listedetay <liste_adi>');
          return;
        }
        
        const listName = args[0].toLowerCase();
        await this.showListDetails(ctx, userId, listName);
      } catch (error) {
        this.logger.error('Listedetay komutu hatası:', error);
      }
    });
    
    this.bot.command(['listesil', 'deletelist'], async (ctx) => {
      this.logger.debug('listesil/deletelist komutu manuel çağrıldı');
      try {
        const userId = ctx.from.id.toString();
        const message = ctx.message;
        const text = 'text' in message ? message.text : '';
        const args = text.split(' ').slice(1);
        
        if (args.length < 1) {
          await ctx.reply('Kullanım: /listesil <liste_adi>');
          return;
        }
        
        const listName = args[0].toLowerCase();
        await this.deleteUserList(ctx, userId, listName);
      } catch (error) {
        this.logger.error('Listesil komutu hatası:', error);
      }
    });

    // Yeni eklenen add_to_list callback için handler ekleyelim, bu sayede kullanıcı mevcut bir listeye sembol ekleyebilecek
    this.bot.action(/add_to_list:(.+):(.+):(.+)/, async (ctx) => {
      if (!ctx.callbackQuery) return;
      
      // Callback verisini parçala
      const callbackData = (ctx.callbackQuery as any).data;
      const match = callbackData.match(/add_to_list:(.+):(.+):(.+)/);
      
      if (!match || match.length < 4) {
        await ctx.answerCbQuery('İşlem yapılamadı');
        return;
      }
      
      const listName = match[1];
      const symbolsStr = match[2];
      const userId = match[3];
      
      try {
        // Virgülle ayrılmış sembolleri diziye çevir
        const symbols = symbolsStr.split(',');
        
        if (symbols.length === 0) {
          await ctx.editMessageText(`Eklenecek sembol bulunamadı.`);
          await ctx.answerCbQuery('İşlem iptal edildi');
          return;
        }
        
        // Liste var mı kontrol et
        const list = await this.symbolService.getListDetails(userId, listName);
        
        if (!list) {
          await ctx.editMessageText(`"${listName}" listesi bulunamadı.`);
          await ctx.answerCbQuery('Liste bulunamadı');
          return;
        }
        
        // Tüm sembolleri eklemeyi dene
        const results: {symbol: string, success: boolean}[] = [];
        
        for (const symbol of symbols) {
          const success = await this.symbolService.addSymbolToList(userId, listName, symbol);
          results.push({ symbol, success });
        }
        
        // Sonuçları kategorilere ayır
        const added = results.filter(r => r.success).map(r => r.symbol);
        const failed = results.filter(r => !r.success).map(r => r.symbol);
        
        // Cevap mesajını hazırla
        let responseMessage = `"${listName}" listesi işlemi:\n\n`;
        
        if (added.length > 0) {
          responseMessage += `✅ Eklenen semboller: ${added.join(', ')}\n`;
        }
        
        if (failed.length > 0) {
          responseMessage += `❌ Eklenemeyen semboller: ${failed.join(', ')}\n`;
          responseMessage += 'Not: Bazı semboller zaten listede olabilir.\n';
        }
        
        responseMessage += `\n• Listeyi görüntülemek için: /liste ${listName}`;
        
        await ctx.editMessageText(responseMessage);
        await ctx.answerCbQuery(added.length > 0 ? 'Semboller eklendi' : 'İşlem tamamlandı');
      } catch (error) {
        this.logger.error(`Mevcut listeye ekleme hatası: ${error.message}`);
        await ctx.editMessageText('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
        await ctx.answerCbQuery('İşlem başarısız');
      }
    });

    this.bot.action(/add_to_alert_list:(.+):(.+):(.+)/, async (ctx) => {
      if (!ctx.callbackQuery) return;
      
      // Callback verisini parçala
      const callbackData = (ctx.callbackQuery as any).data;
      const match = callbackData.match(/add_to_alert_list:(.+):(.+):(.+)/);
      
      if (!match || match.length < 4) {
        await ctx.answerCbQuery('İşlem yapılamadı');
        return;
      }
      
      const listName = match[1];
      const symbolsStr = match[2];
      const chatId = match[3];
      
      try {
        // Virgülle ayrılmış sembolleri diziye çevir
        const allParams = symbolsStr.split(',');
        const results: { symbol: string, threshold: number, success: boolean }[] = [];
        
        // Parametreleri sembol-eşik çiftleri olarak işleme
        for (let i = 0; i < allParams.length; i++) {
          const symbol = allParams[i].toUpperCase();
          let threshold = 5; // Varsayılan eşik
          
          // Sonraki parametre sayı ise, eşik değeri olarak kabul et
          if (i + 1 < allParams.length && !isNaN(parseFloat(allParams[i + 1]))) {
            threshold = parseFloat(allParams[i + 1]);
            i++; // Eşik değerini atla
          }
          
          // Sembolü ekle
          const success = await this.alertService.addSymbolToAlertList(
            chatId,
            listName,
            symbol,
            threshold
          );
          
          results.push({ symbol, threshold, success });
        }
        
        // Sonuçları kategorilere ayır
        const added = results.filter(r => r.success);
        const failed = results.filter(r => !r.success).map(r => r.symbol);
        
        // Cevap mesajını hazırla
        let responseMessage = `"${listName}" listesi işlemi:\n\n`;
        
        if (added.length > 0) {
          const addedInfo = added.map(item => `✅ ${item.symbol} (Eşik: %${item.threshold})`);
          responseMessage += addedInfo.join('\n') + '\n\n';
        }
        
        if (failed.length > 0) {
          responseMessage += `❌ Eklenemeyen semboller: ${failed.join(', ')}\n`;
          responseMessage += 'Not: Bazı semboller zaten listede olabilir.\n\n';
        }
        
        responseMessage += `• Listeyi görüntülemek için: /alerts ${listName}\n`;
        responseMessage += `• Daha fazla sembol eklemek için: /alertsadd ${listName} <sembol>`;
        
        await ctx.editMessageText(responseMessage);
        await ctx.answerCbQuery(added.length > 0 ? 'Semboller eklendi' : 'İşlem tamamlandı');
      } catch (error) {
        this.logger.error(`Uyarı listesine ekleme hatası: ${error.message}`);
        await ctx.editMessageText('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
        await ctx.answerCbQuery('İşlem başarısız');
      }
    });
  }

  /**
   * Bot başlangıç metodu
   */
  async onModuleInit() {
    // Bot başlatıldığında komutları ayarla
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Botu başlat ve bilgi al' },
      { command: 'help', description: 'Yardım' },
      { command: 'fiyat', description: 'Kripto para veya hisse senedi fiyatı göster' },
      { command: 'asagi', description: 'Günlük en çok düşen kriptolar' },
      { command: 'yukari', description: 'Günlük en çok yükselen kriptolar' },
      { command: 'liste', description: 'Sembol listelerini göster veya yönet' },
      { command: 'ekle', description: 'Sembolleri listeye ekle' },
      { command: 'cikar', description: 'Sembolleri listeden çıkar' },
      { command: 'alerts', description: 'Fiyat uyarı listelerini göster veya yönet' },
      { command: 'alertsadd', description: 'Sembol uyarı listesine ekle' },
      { command: 'alertsremove', description: 'Sembol uyarı listesinden çıkar' },
      { command: 'data', description: 'Veritabanına sembol ekle (admin)' },
      { command: 'p', description: 'Belirtilen sembolün fiyatını tekrarlı göster (eğlence)' },
    ]);
    
    this.logger.log('Bot başlatıldı ve komut listesi ayarlandı');
    
    const botInfo = await this.bot.telegram.getMe();
    this.logger.log(`Bot başlatıldı! @${botInfo.username} adıyla çalışıyor.`);
    
    // Komutları tanımla - gruplar için
    try {
      const commands = [
        { command: 'kripto', description: 'Kripto para fiyatlarını göster' },
        { command: 'hisse', description: 'Hisse senedi fiyatlarını göster' },
        { command: 'alerts', description: 'Uyarı listeleri yönetimi' },
        { command: 'alertsadd', description: 'Uyarı listesine sembol ekle' },
        { command: 'alertremove', description: 'Uyarı listesinden sembol çıkar' },
        { command: 'alertrmv', description: 'alertremove komutunun kısaltması' },
        { command: 'liste', description: 'Sembol listeleri yönetimi' },
        { command: 'ekle', description: 'Liste oluştur veya sembolleri ekle' },
        { command: 'cikar', description: 'Listeden sembol çıkar' },
        { command: 'listeler', description: 'Tüm listeleri göster' },
        { command: 'lists', description: 'Tüm listeleri göster' },
        { command: 'listedetay', description: 'Liste detaylarını göster' },
        { command: 'fiyat', description: 'Fiyat göster' },
        { command: 'help', description: 'Yardım' },
        { command: 'start', description: 'Bot başlat' }
      ];
      
      // Önce özel mesajlar için komutları ayarla
      await this.bot.telegram.setMyCommands(commands, { scope: { type: 'all_private_chats' } });
      
      // Sonra gruplar için komutları ayarla
      await this.bot.telegram.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
      
      this.logger.log('Bot komutları yapılandırıldı - özel mesajlar ve gruplar için');
    } catch (e) {
      this.logger.error('Bot komutları ayarlanırken hata:', e);
    }
    
    // Data komutunu tanımla
    this.bot.command('data', async (ctx) => {
      try {
        if (!ctx.message) return;
        
        const chatId = ctx.message.chat.id.toString();
        const userId = (ctx.message as any).from.id.toString();
        const messageText = (ctx.message as any)?.text || '';
        const parts = messageText.split(' ').filter(p => p.trim() !== '');
        
        // İşlem gönderen kişinin ID'sini debug için logla
        this.logger.log(`Data komutunu kullanan kullanıcı: chatId=${chatId}, userId=${userId}`);
        this.logger.log(`Mevcut admin listesi: ${process.env.ADMIN_USERS}`);
        
        // Admin kontrolü - hem userId hem de chatId kontrolü yapalım 
        const adminUsers = process.env.ADMIN_USERS ? process.env.ADMIN_USERS.split(',') : [];
        const isAdmin = adminUsers.includes(userId) || adminUsers.includes(chatId);
        
        if (!isAdmin) {
          this.logger.log(`Admin olmayan kullanıcı: ${userId}`);
          await ctx.reply('Bu komut sadece bot yöneticileri tarafından kullanılabilir.');
          return;
        }
        
        // Admin doğrulandı, işleme devam et
        this.logger.log(`Admin doğrulandı: ${userId}, işleme devam ediliyor...`);
        
        // Yeterli parametre var mı? (/data [borsa|kripto] symbol1 symbol2...)
        if (parts.length < 3) {
          await ctx.reply(
            'Veritabanına sembol eklemek için komut formatı:\n' +
            '/data borsa SYMBOL1 SYMBOL2 ... (Hisse senetleri için)\n' +
            '/data kripto SYMBOL1 SYMBOL2 ... (Kripto paralar için)\n' +
            'Örnek: /data borsa THYAO ASELS SASA\n' +
            'Örnek: /data kripto BTC ETH SOL'
          );
          return;
        }
        
        const dataType = parts[1].toLowerCase();
        
        // Geçerli veri tipi kontrolü
        if (dataType !== 'borsa' && dataType !== 'kripto') {
          await ctx.reply('Lütfen geçerli bir veri tipi belirtin: "borsa" veya "kripto"');
          return;
        }
        
        // Sembolleri temizle ve büyük harfe çevir
        const symbols = parts.slice(2).map(s => s.trim().toUpperCase());
        
        if (symbols.length === 0) {
          await ctx.reply('Lütfen en az bir sembol belirtin.');
          return;
        }
        
        this.logger.log(`İşlenecek semboller: ${symbols.join(', ')}`);
        
        // Başarılı ve başarısız eklemeleri takip et
        const results: { symbol: string, success: boolean, reason?: string }[] = [];
        
        // Sembollerin her birini veritabanına ekle
        for (const symbol of symbols) {
          try {
            // Sembol türünü belirle
            const symbolType = dataType === 'borsa' ? 'stock' : 'crypto';
            
            // Sembol adını oluştur (varsayılan)
            const symbolName = `${symbol} ${symbolType === 'stock' ? 'Hisse Senedi' : 'Kripto Para'}`;
            
            // Sembol verisi oluştur
            const symbolData = {
              symbol,
              type: symbolType as 'stock' | 'crypto',
              name: symbolName,
              aliases: [symbol.toLowerCase()], // Alternatif isimler eklenebilir
              popularity: 50 // Orta düzey popülerlik
            };
            
            // Veritabanına ekle
            await this.symbolService.addOrUpdateSymbol(symbolData);
            
            results.push({
              symbol,
              success: true
            });
            
            this.logger.log(`Sembol başarıyla eklendi: ${symbol}`);
          } catch (error) {
            this.logger.error(`Sembol ekleme hatası (${symbol}): ${error.message}`);
            
            results.push({
              symbol,
              success: false,
              reason: error.message
            });
          }
        }
        
        // Sonuç mesajını oluştur
        const successSymbols = results.filter(r => r.success).map(r => r.symbol);
        const failedSymbols = results.filter(r => !r.success).map(r => r.symbol);
        
        let responseMessage = `📊 Veritabanı Güncelleme Sonucu (${dataType.toUpperCase()}):\n\n`;
        
        if (successSymbols.length > 0) {
          responseMessage += `✅ Başarıyla eklenen semboller (${successSymbols.length}):\n${successSymbols.join(', ')}\n\n`;
        }
        
        if (failedSymbols.length > 0) {
          responseMessage += `❌ Eklenemeyen semboller (${failedSymbols.length}):\n${failedSymbols.join(', ')}`;
        }
        
        this.logger.log(`İşlem tamamlandı, cevap gönderiliyor: ${responseMessage}`);
        
        await ctx.reply(responseMessage);
        
      } catch (error) {
        this.logger.error(`Data komut hatası: ${error.message}`, error.stack);
        await ctx.reply('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      }
    });
    
    // Tekrarlı fiyat komutu
    this.bot.command('p', async (ctx) => {
      try {
        if (!ctx.message) return;
        
        const messageText = (ctx.message as any)?.text || '';
        const parts = messageText.split(' ').filter(p => p.trim() !== '');
        
        // Komut formatını kontrol et
        if (parts.length < 2) {
          await ctx.reply(
            'Lütfen en az bir sembol belirtin.\n' +
            'Örnek: /p BTC\n' +
            'Tekrarlı gösterim için: /p BTC 5'
          );
          return;
        }
        
        // Sembol ve tekrar sayısını al
        const symbol = parts[1].toUpperCase();
        
        // Varsayılan olarak 1 kez göster, ikinci parametre varsa ve sayı ise o kadar tekrarla
        let repeatCount = 1;
        if (parts.length > 2 && !isNaN(parseInt(parts[2]))) {
          repeatCount = parseInt(parts[2]);
          
          // Maksimum tekrar sayısını sınırla (spam önlemi)
          if (repeatCount > 20) {
            repeatCount = 20;
            await ctx.reply('Maksimum 20 kere tekrarlayabilirim 😊');
          }
        }
        
        // Fiyat bilgisi al
        const prices = await this.priceService.getPrices([symbol]);
        
        if (prices.length === 0) {
          await ctx.reply(`${symbol} için fiyat bilgisi bulunamadı.`);
          return;
        }
        
        const price = prices[0];
        const formattedPrice = this.formatPriceForDisplay(price);
        
        // Tekrarlı mesaj oluştur
        let responseMessage = '';
        for (let i = 0; i < repeatCount; i++) {
          responseMessage += `${i+1}. ${formattedPrice}\n`;
          
          // Çok uzun mesajları bölmek için
          if (i > 0 && i % 10 === 0) {
            await ctx.reply(responseMessage);
            responseMessage = '';
          }
        }
        
        // Kalan mesajı gönder
        if (responseMessage) {
          await ctx.reply(responseMessage);
        }
        
      } catch (error) {
        this.logger.error(`Tekrarlı fiyat komut hatası: ${error.message}`);
        await ctx.reply('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      }
    });
  }

  @Start()
  async handleStart(@Ctx() ctx: Context): Promise<void> {
    const userId = ctx.from.id;
    await ctx.reply(
      `Merhaba ${ctx.from.first_name}! 🚀\n\n` +
      'Kripto ve hisse senedi fiyatlarını sorgulayabileceğiniz ve fiyat uyarıları alabileceğiniz bota hoş geldiniz.\n\n' +
      '📊 Fiyat sorgulamak için:\n' +
      '/p btc eth (kripto fiyatları için)\n' +
      '/s aapl thyao (hisse fiyatları için)\n\n' +
      '📋 Listeler oluşturmak için:\n' +
      '/liste yeni <liste adı>\n\n' +
      '🔔 Fiyat uyarıları için:\n' + 
      '/alerts yeni <liste adı>\n\n' +
      'Tüm komutları görmek için /help yazabilirsiniz.'
    );
  }

  @Help()
  async handleHelp(@Ctx() ctx: Context) {
    // Komut listesi ve açıklamaları
    const commands = [
      { cmd: '/p', desc: 'Kripto fiyat bilgisi, örn: /p btc eth' },
      { cmd: '/s', desc: 'Hisse fiyat bilgisi, örn: /s aapl' },
      { cmd: '/f', desc: 'Kripto ve token ismi ile arama, örn: /f bitcoin' },
      { cmd: '/liste', desc: 'Kullanıcı listelerini görüntüle ve yönet' },
      { cmd: '/ekle', desc: 'Listeye sembol ekle, örn: /ekle liste_adı btc' },
      { cmd: '/cikar', desc: 'Listeden sembol çıkar, örn: /cikar liste_adı btc' },
      { cmd: '/alerts', desc: 'Fiyat uyarı listelerini görüntüle ve yönet' },
      { cmd: '/alertsadd', desc: 'Uyarı listesine sembol ekle, örn: /alertsadd liste_adı btc 5' },
      { cmd: '/alertremove', desc: 'Uyarı listesinden sembol çıkar, örn: /alertremove liste_adı btc' },
    ];

    // Komut listesini formatlama
    const commandsText = commands.map(c => `${c.cmd} - ${c.desc}`).join('\n');

    // Yardım mesajı
    const helpMessage = `🤖 *Bot Komutları*\n\n${commandsText}\n\n*Fiyat Uyarıları*\nFiyat uyarı listeleri sayesinde belirli sembollerin fiyat değişimlerini takip edebilirsiniz. Fiyat belirli bir yüzde değişim eşiğini aştığında size otomatik bildirim gönderilir.`;

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
  }

  @Command('p')
  async getCryptoPrice(@Ctx() ctx: Context) {
    try {
      const message = ctx.message;
      const text = 'text' in message ? message.text : '';
      const args = text.split(' ').slice(1);
      const userId = ctx.from.id.toString();

      if (!args.length) {
        await ctx.reply('Lütfen en az bir kripto para sembolü belirtin. Örnek: /p btc');
        return;
      }

      // Show "typing" action
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      // Doğrudan kripto fiyatlarını getir (önce Binance, bulamazsa CMC)
      try {
      const prices = await this.priceService.getPrices(args, 'crypto');
      
      if (!prices.length) {
          await ctx.reply('Belirtilen semboller için kripto para verisi bulunamadı.');
        return;
      }

      // Format and display prices, adding source indicator
      const formattedPrices = prices.map(price => {
        const formattedPrice = this.priceService.formatPrice(price);
        // Add small indicator of data source
          return `${formattedPrice}`;
      });
      
      await ctx.reply(formattedPrices.join('\n'), { parse_mode: 'HTML' });
      
        // Kullanıcı geçmişini güncelle - hatayı yakalayalım
        try {
          await this.symbolService.updateUserHistory(userId, 'crypto');
        } catch (historyError) {
          // Hata logla ama kullanıcıya gösterme
          this.logger.error(`Error updating history: ${historyError.message}`);
        }
      } catch (priceError) {
        this.logger.error(`Error fetching prices: ${priceError.message}`);
        await ctx.reply('Kripto para fiyatları alınırken hata oluştu. Lütfen daha sonra tekrar deneyin.');
      }
    } catch (error) {
      this.logger.error(`Error in cryptocurrency command: ${error.message}`);
      await ctx.reply('Kripto para fiyatları alınırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }
  
  @Command('s')
  async getSmartPrices(@Ctx() ctx: Context) {
    try {
      const message = ctx.message;
      const text = 'text' in message ? message.text : '';
      const args = text.split(' ').slice(1);
      const userId = ctx.from.id.toString();

      if (!args.length) {
        await ctx.reply('Lütfen en az bir sembol veya şirket adı belirtin. Örnek: /s btc apple');
        return;
      }

      // Show "typing" action
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      // Her argümanı ayrı ayrı işleyeceğiz
      const results = [];
      
      for (const arg of args) {
        try {
          this.logger.debug(`Processing symbol: ${arg}`);
          
        // Akıllı sembol çözümlemesi yap
        const matches = await this.symbolService.resolveSymbol(arg, userId);
        
        if (matches.length === 0) {
            results.push(`"${arg}" için eşleşme bulunamadı`);
          continue;
        }
        
          // Tam eşleşme kontrolü (birebir sembol ismi eşleşmesi)
          const exactMatch = matches.find(m => 
            m.symbol.toUpperCase() === arg.toUpperCase() || 
            m.score >= 95
          );
          
          // Tam eşleşme varsa, direkt onu kullan - bulanık eşleşme gösterme
          if (exactMatch) {
            try {
              this.logger.debug(`Exact match found for ${arg}: ${exactMatch.symbol} with score ${exactMatch.score}`);
              // Type olarak açıkça 'stock' belirtiyoruz
              const prices = await this.priceService.getPrices([exactMatch.symbol], 'stock');
              
              // Kullanıcı geçmişini güncelle - sembol tipini 'stock' olarak belirt
              await this.symbolService.updateUserHistory(userId, 'stock');
          
          if (prices.length > 0) {
            const formattedPrice = this.priceService.formatPrice(prices[0]);
                results.push(`${formattedPrice}`);
          } else {
                results.push(`${exactMatch.symbol} için fiyat verisi bulunamadı`);
              }
            } catch (priceError) {
              this.logger.error(`Error fetching price for ${exactMatch.symbol}: ${priceError.message}`);
              results.push(`${exactMatch.symbol} fiyatı alınırken hata oluştu`);
              continue;
            }
          }
          // Tam eşleşme yoksa ve sadece bir tane eşleşme varsa
          else if (matches.length === 1) {
            // Tek eşleşme varsa doğrudan fiyat sorgula ve 'stock' tipini zorla
            const match = matches[0];
            try {
              this.logger.debug(`Getting prices for ${match.symbol} with forced stock type`);
              // Type olarak açıkça 'stock' belirtiyoruz
              const prices = await this.priceService.getPrices([match.symbol], 'stock');
              
              // Kullanıcı geçmişini güncelle - sembol tipini 'stock' olarak belirt
              await this.symbolService.updateUserHistory(userId, 'stock');
              
              if (prices.length > 0) {
                const formattedPrice = this.priceService.formatPrice(prices[0]);
                results.push(`${formattedPrice}`);
              } else {
                results.push(`${match.symbol} için fiyat verisi bulunamadı`);
              }
            } catch (priceError) {
              this.logger.error(`Error fetching price for ${match.symbol}: ${priceError.message}`);
              results.push(`${match.symbol} fiyatı alınırken hata oluştu`);
              continue;
          }
        } else {
            // Birden fazla eşleşme var ve tam eşleşme yok, kullanıcıya seçenekler sun
            try {
              // Eşleşmeleri sırala
              matches.sort((a, b) => b.score - a.score);
              
          const keyboard = Markup.inlineKeyboard(
            matches.slice(0, 3).map(match => 
              Markup.button.callback(
                    `${match.symbol} (${match.name})`, 
                    `select_symbol:${match.symbol}:stock:${userId}`
                  )
                )
              );
              
              await ctx.reply(`"${arg}" için birden fazla eşleşme bulundu, lütfen seçim yapın:`, keyboard);
            } catch (buttonError) {
              this.logger.error(`Error creating buttons for ${arg}: ${buttonError.message}`);
              results.push(`"${arg}" için seçenekler oluşturulurken hata oluştu`);
            }
            continue;
          }
        } catch (searchError) {
          this.logger.error(`Error processing argument ${arg}: ${searchError.message}`);
          results.push(`"${arg}" işlenirken hata oluştu`);
          continue;
        }
      }
      
      if (results.length > 0) {
        await ctx.reply(results.join('\n'), { parse_mode: 'HTML' });
      }
    } catch (error) {
      this.logger.error(`Error in smart price command: ${error.message}`);
      await ctx.reply('Fiyatlar alınırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }
  
  @Command('f')
  async getForwardPrice(@Ctx() ctx: Context) {
    // Sessizce /s komutuna yönlendir, uyarı gösterme
    await this.getSmartPrices(ctx);
  }
  
  @Action(/select_symbol:(.+):(.+):(.+)/)
  async handleSymbolSelection(@Ctx() ctx: Context) {
    try {
      const callbackQuery = 'callback_query' in ctx.update ? ctx.update.callback_query : null;
      if (!callbackQuery) return;
      
      const match = (ctx as any).match as RegExpExecArray;
      const symbol = match[1];
      // Tipi 'stock' olarak zorla
      const type = 'stock' as 'stock';
      const userId = match[3];
      
      // "typing" gösterimi
      await ctx.telegram.sendChatAction(callbackQuery.from.id, 'typing');
      
      // Buton mesajını güncelle
      await ctx.editMessageText(`${symbol} için fiyat alınıyor...`);
      
      try {
        // Fiyatı getir - type olarak açıkça 'stock' belirtiyoruz
      const prices = await this.priceService.getPrices([symbol], type);
      
        // Kullanıcı geçmişini güncelle - 'stock' olarak kaydet
        try {
          await this.symbolService.updateUserHistory(userId, type);
        } catch (historyError) {
          this.logger.error(`Error updating history: ${historyError.message}`);
        }
      
      // Kullanıcının sorgu tercihini kaydet - ilk metindeki orijinal sorguyu al
        try {
      if (callbackQuery.message && 'text' in callbackQuery.message) {
        const messageText = callbackQuery.message.text;
            // Mesaj formatından sorguyu çıkar
            const matchText = messageText.match(/"([^"]+)" için birden fazla eşleşme bulundu/) || 
                              messageText.match(/Multiple matches found for "([^"]+)"/);
                              
            if (matchText && matchText[1]) {
              const originalQuery = matchText[1];
          // Kullanıcı tercihini kaydet
              await this.symbolService.updateUserQueryPreference(userId, originalQuery, symbol);
          this.logger.debug(`Saved user preference: ${userId} -> ${originalQuery} -> ${symbol}`);
        }
          }
        } catch (prefError) {
          this.logger.error(`Error saving user preference: ${prefError.message}`);
      }
      
      if (prices.length > 0) {
        const formattedPrice = this.priceService.formatPrice(prices[0]);
          await ctx.editMessageText(`${formattedPrice}`, { parse_mode: 'HTML' });
      } else {
          await ctx.editMessageText(`${symbol} için fiyat verisi bulunamadı`);
        }
      } catch (priceError) {
        this.logger.error(`Error fetching price in selection: ${priceError.message}`);
        await ctx.editMessageText(`${symbol} için fiyat alınırken hata oluştu. Lütfen daha sonra tekrar deneyin.`);
      }
    } catch (error) {
      this.logger.error(`Error in symbol selection handler: ${error.message}`);
      await ctx.editMessageText('İşlem sırasında bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }

  @Command('liste')
  async handleLists(@Ctx() ctx: Context) {
    try {
      const userId = ctx.from.id.toString();
      const message = ctx.message;
      const text = 'text' in message ? message.text : '';
      const args = text.split(' ').slice(1);
      
      if (args.length === 0) {
        // Listeleri göster
        return await this.showUserLists(ctx, userId);
      }
      
      const subCommand = args[0].toLowerCase();
      
      if (subCommand === 'yeni' || subCommand === 'ekle') {
        if (args.length < 2) {
          await ctx.reply('Lütfen bir liste adı belirtin. Örnek: /liste yeni Favori Kripto');
          return;
        }
        
        const listName = args.slice(1).join(' ');
        return await this.createNewList(ctx, userId, listName);
      }
      
      if (subCommand === 'sil') {
        if (args.length < 2) {
          await ctx.reply('Lütfen silmek istediğiniz liste adını belirtin. Örnek: /liste sil Favori Kripto');
          return;
        }
        
        const listName = args.slice(1).join(' ');
        return await this.deleteUserList(ctx, userId, listName);
      }
      
      if (subCommand === 'göster') {
        if (args.length < 2) {
          await ctx.reply('Lütfen görüntülemek istediğiniz liste adını belirtin. Örnek: /liste göster Favori Kripto');
          return;
        }
        
        const listName = args.slice(1).join(' ');
        return await this.showListDetails(ctx, userId, listName);
      }
      
      // Belirtilen argüman bir alt komut değilse, liste adı kabul et ve detaylarını göster
      const listName = args.join(' ');
      return await this.showListDetails(ctx, userId, listName);
      
    } catch (error) {
      this.logger.error(`Liste komutu hatası: ${error.message}`);
      await ctx.reply('Listeleri işlerken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }
  
  @Command('ekle')
  async addToList(@Ctx() ctx: Context) {
    try {
      const userId = ctx.from.id.toString();
      const message = ctx.message;
      const text = 'text' in message ? message.text : '';
      const args = text.split(' ').slice(1);
      
      if (args.length < 2) {
        await ctx.reply('Kullanım: /ekle <liste adı> <sembol1> [sembol2] [sembol3] ...\nÖrnek: /ekle Kripto BTC ETH SOL\n\nBir liste oluşturmak için: /liste yeni <liste adı>');
        return;
      }
      
      const listName = args[0];
      const symbols = args.slice(1); // İlk argüman liste adı, gerisi semboller
      
      // Hepsini eklemek için birden fazla API çağrısı yap
      const results: {symbol: string, success: boolean}[] = [];
      
      // "typing" gösterimi
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      // Liste var mı kontrol et
      const list = await this.symbolService.getListDetails(userId, listName);
      if (!list) {
        // İlk sembole göre türü tahmin et
        const firstSymbol = symbols[0].toUpperCase();
        
        // Yaygın borsa kodları için kontrol listesi
        const stockSymbols = [
          // Türk hisseleri - BIST
          'THYAO', 'ASELS', 'KCHOL', 'SISE', 'GARAN', 'AKBNK', 'TUPRS', 'BIMAS', 'FROTO', 'EREGL', 'YKBNK',
          'PGSUS', 'TAVHL', 'TCELL', 'SAHOL', 'HEKTS', 'VESTL', 'TTKOM', 'DOHOL', 'KRDMD', 'PETKM', 
          'EKGYO', 'TOASO', 'SASA', 'ARCLK', 'KOZAA', 'KOZAL', 'MAVI', 'ISCTR', 'ODAS', 'ALFAS',
          // Yabancı hisseler
          'AAPL', 'MSFT', 'AMZN', 'GOOG', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'WMT', 'JNJ', 'PG', 'BABA',
          'XOM', 'DIS', 'NFLX', 'UBER', 'INTC', 'IBM', 'F', 'GM', 'AMD', 'MCD', 'KO', 'PEP', 'NKE'
        ];
        
        // Kripto para birimleri listesi
        const cryptoSymbols = [
          'BTC', 'ETH', 'XRP', 'SOL', 'DOT', 'ADA', 'AVAX', 'DOGE', 'PEPE', 'SHIB', 'BNB', 'MATIC', 
          'LINK', 'LTC', 'DOT', 'UNI', 'ATOM', 'XLM', 'TRX', 'DAI', 'BCH', 'USDC', 'USDT', 'CAKE'
        ];
        
        // Sembol formatına göre tip belirle
        const isStockByFormat = firstSymbol.includes('.') || firstSymbol.includes('-') || /XU\d+/.test(firstSymbol);
        
        // Sembol yaygın borsa veya kripto listelerinde var mı kontrol et
        const isStock = stockSymbols.includes(firstSymbol) || isStockByFormat;
        const isCrypto = cryptoSymbols.includes(firstSymbol);
        
        // Kullanıcının belirttiği liste adı
        const specifiedListName = listName.toLowerCase();
        
        // Önerilen liste adı - bu sembol için uygun olan liste
        const suggestedListName = isStock ? 'Borsa' : 'Kripto';
        
        // Mevcut listeleri kontrol et
        const existingLists = await this.symbolService.getUserLists(ctx.from.id.toString());
        const hasKriptoList = existingLists.some(l => l.listName.toLowerCase() === 'kripto');
        const hasBorsaList = existingLists.some(l => l.listName.toLowerCase() === 'borsa');
        
        // Sembol tipine uygun liste zaten varsa, onu öner
        let preferredListName = '';
        if (isStock && hasBorsaList) {
          preferredListName = 'Borsa';
        } else if (isCrypto && hasKriptoList) {
          preferredListName = 'Kripto';
        }
        
        // Butonlar
        const buttons = [];
        
        // Kullanıcının istediği liste adı ile buton ekle
        buttons.push(
          Markup.button.callback(`✅ "${listName}" listesi oluştur`, `create_symbol_list:${listName}:${firstSymbol}:${ctx.from.id.toString()}`)
        );
        
        // Eğer önerilen liste adı farklıysa ve mevcut değilse ona da buton ekle
        if (suggestedListName.toLowerCase() !== listName.toLowerCase()) {
          buttons.push(
            Markup.button.callback(`🔄 "${suggestedListName}" listesi oluştur`, `create_symbol_list:${suggestedListName}:${firstSymbol}:${ctx.from.id.toString()}`)
          );
        }
        
        // Eğer tercih edilen liste varsa, sembolleri ona eklemek için buton ekle
        if (preferredListName && preferredListName.toLowerCase() !== listName.toLowerCase()) {
          buttons.push(
            Markup.button.callback(`➕ "${preferredListName}" listesine ekle`, `add_to_list:${preferredListName}:${symbols.join(',')}:${ctx.from.id.toString()}`)
          );
        }
        
        // Inline klavye oluştur
        const keyboard = Markup.inlineKeyboard(buttons);
        
        let responseMessage = `"${listName}" adında bir listeniz yok.\n\n`;
        
        // Sembol tipi bilgisi ekle
        if (isStock) {
          responseMessage += `📈 ${firstSymbol} bir hisse senedi sembolüne benziyor.\n`;
        } else if (isCrypto) {
          responseMessage += `🔹 ${firstSymbol} bir kripto para sembolüne benziyor.\n`;
        }
        
        responseMessage += `${symbols.join(', ')} sembollerini eklemek için önce bir liste oluşturmalısınız.`;
        
        await ctx.reply(responseMessage, keyboard);
        return;
      }
      
      // Tüm sembolleri eklemeyi dene
      for (const symbol of symbols) {
        const success = await this.symbolService.addSymbolToList(userId, listName, symbol);
        results.push({ symbol, success });
      }
      
      // Sonuçları kategorilere ayır
      const added = results.filter(r => r.success).map(r => r.symbol);
      const failed = results.filter(r => !r.success).map(r => r.symbol);
      
      // Cevap mesajını hazırla
      let responseMessage = '';
      
      if (added.length > 0) {
        responseMessage += `✅ Eklenen semboller: ${added.join(', ')}\n`;
      }
      
      if (failed.length > 0) {
        responseMessage += `❌ Eklenemeyen semboller: ${failed.join(', ')}\n`;
        responseMessage += 'Not: Bazı semboller zaten listede olduğu için eklenememiş olabilir.';
      }
      
      // Sonuç mesajını gönder
      await ctx.reply(responseMessage || 'Hiçbir sembol eklenemedi.');
      
    } catch (error) {
      this.logger.error(`Listeye ekleme hatası: ${error.message}`);
      await ctx.reply('Sembolleri listeye eklerken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }
  
  @Command('çıkar')
  async handleCikarAltCommand(@Ctx() ctx: Context) {
    // Bu komut /cikar'a yönlendirir - Türkçe karakter uyumluluğu için
    return this.handleCikarCommandAscii(ctx);
  }
  
  @Command('cikar')
  async handleCikarCommandAscii(@Ctx() ctx: Context) {
    try {
      const userId = ctx.from.id.toString();
      const message = ctx.message;
      const text = 'text' in message ? message.text : '';
      const args = text.split(' ').slice(1);
      
      if (args.length < 2) {
        await ctx.reply('Kullanım: /cikar <liste adı> <sembol>\nÖrnek: /cikar Kripto BTC');
        return;
      }
      
      const listName = args[0];
      const symbol = args[1];
      
      // "typing" gösterimi
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      const success = await this.symbolService.removeSymbolFromList(userId, listName, symbol);
      
      if (success) {
        await ctx.reply(`"${symbol}" sembolü "${listName}" listesinden çıkarıldı.`);
      } else {
        // Hata sebebini kontrol et
        const list = await this.symbolService.getListDetails(userId, listName);
        if (!list) {
          await ctx.reply(`"${listName}" adında bir listeniz yok.`);
        } else {
          await ctx.reply(`"${symbol}" sembolü listede bulunamadı.`);
        }
      }
    } catch (error) {
      this.logger.error(`Listeden çıkarma hatası: ${error.message}`);
      await ctx.reply('Sembolü listeden çıkarırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }
  
  // Yardımcı metodlar
  private async createNewList(ctx: Context, userId: string, listName: string): Promise<void> {
    const success = await this.symbolService.createUserList(userId, listName);
    
    if (success) {
      await ctx.reply(`"${listName}" listesi başarıyla oluşturuldu.\nSembol eklemek için: /ekle ${listName} <sembol>`);
    } else {
      await ctx.reply(`"${listName}" adında bir listeniz zaten var. Farklı bir isim deneyin.`);
    }
  }
  
  private async showUserLists(ctx: Context, userId: string): Promise<void> {
    const lists = await this.symbolService.getUserLists(userId);
    
    if (lists.length === 0) {
      await ctx.reply('Henüz hiç listeniz yok.\nYeni liste oluşturmak için: /liste yeni <liste adı>');
      return;
    }
    
    const listMessages = lists.map(list => `📋 ${list.listName} (${list.symbolCount} sembol)`);
    
    let message = 'Listeleriniz:\n\n' + 
      listMessages.join('\n') + 
      '\n\nBir listeyi görüntülemek için: /liste <liste adı>' +
      '\nYeni liste oluşturmak için: /liste yeni <liste adı>' +
      '\nListe silmek için: /liste sil <liste adı>';
    
    await ctx.reply(message);
  }
  
  private async showListDetails(ctx: Context, userId: string, listName: string): Promise<void> {
    const list = await this.symbolService.getListDetails(userId, listName);
    
    if (!list) {
      await ctx.reply(`"${listName}" adında bir listeniz yok. Yeni liste oluşturmak için: /liste yeni ${listName}`);
      return;
    }
    
    if (list.symbols.length === 0) {
      await ctx.reply(
        `"${list.listName}" listesi boş.\n` +
        `Sembol eklemek için: /ekle ${list.listName} <sembol>\n` +
        `Örnek: /ekle ${list.listName} BTC`
      );
      return;
    }
    
    // Sembolleri basit liste olarak göster (fiyat bilgisi olmadan)
    const symbolLines = list.symbols.map(symbol => `• ${symbol}`);
    
    await ctx.reply(
      `"${list.listName}" Listesi (${list.symbols.length} sembol):\n\n` +
      symbolLines.join('\n') +
      '\n\n' +
      'İşlemler:\n' +
      `• Listeye sembol eklemek için: /ekle ${list.listName} <sembol>\n` +
      `• Listeden sembol çıkarmak için: /cikar ${list.listName} <sembol>\n` +
      `• Tüm listeleri görüntülemek için: /liste`
    );
  }
  
  private async deleteUserList(ctx: Context, userId: string, listName: string): Promise<void> {
    const success = await this.symbolService.deleteList(userId, listName);
    
    if (success) {
      await ctx.reply(`"${listName}" listesi başarıyla silindi.`);
    } else {
      await ctx.reply(`"${listName}" adında bir listeniz yok.`);
    }
  }

  @On('text')
  async handleTextMessage(@Ctx() ctx: Context) {
    try {
      const message = ctx.message;
      const text = 'text' in message ? message.text : '';
      const userId = ctx.from.id.toString();
      
      // Mesaj bir komutsa işleme (komutlar "/" ile başlar)
      if (text.startsWith('/')) {
        return;
      }
      
      // Liste adı olarak kontrol et
      const listName = text.trim().toLowerCase();
      const list = await this.symbolService.getListDetails(userId, listName);
      
      if (!list) {
        // Mesaj bir liste adı değil, işlem yapma
        return;
      }
      
      if (list.symbols.length === 0) {
        await ctx.reply(
          `"${list.listName}" listesi boş.\n` +
          `Sembol eklemek için: /ekle ${list.listName} <sembol>\n` +
          `Örnek: /ekle ${list.listName} BTC`
        );
        return;
      }
      
      // "typing" gösterimi
      await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
      
      // Liste türünü akıllıca belirle:
      // 1. Liste adı içinde "hisse" kelimesi geçiyorsa direkt stock olarak işaretle
      // 2. Değilse, içeriğe bakarak karar ver
      let assetType: 'stock' | 'crypto' = 'crypto';
      
      if (list.listName.includes('hisse')) {
        // Liste adından dolayı stock tipi
        assetType = 'stock';
      } else {
        // Yaygın hisse senetleri listesi oluştur
        const commonStocks = [
          'AAPL', 'MSFT', 'AMZN', 'GOOG', 'GOOGL', 'META', 'TSLA', 'NVDA', 'AMD', 'INTC',
          'IBM', 'NFLX', 'CSCO', 'ORCL', 'JPM', 'V', 'MA', 'BAC', 'XU100', 'BIST100'
        ];
        
        // Liste içerisindeki sembollerden kaçı yaygın hisse senedi?
        const stockSymbolCount = list.symbols.filter(symbol => 
          commonStocks.includes(symbol) || 
          symbol.endsWith('.IS') || 
          symbol.includes('XU')
        ).length;
        
        // Eğer sembollerin çoğunluğu hisse senedi ise stock API'sini kullan
        if (stockSymbolCount >= list.symbols.length / 2) {
          assetType = 'stock';
          this.logger.debug(`Liste '${list.listName}' içerik analizi sonucu stock tipi olarak belirlendi (${stockSymbolCount}/${list.symbols.length} hisse senedi)`);
        }
      }
      
      this.logger.debug(`Liste fiyatlarını getirme: "${list.listName}" (${list.symbols.length} sembol), tip: ${assetType}`);
      
      try {
        // Fiyatları getir (hisse senedi veya kripto para olarak)
        const prices = await this.priceService.getPrices(list.symbols, assetType);
        
        if (prices.length === 0) {
          await ctx.reply(`"${list.listName}" listesindeki semboller için veri bulunamadı.`);
          return;
        }
        
        // Fiyatları formatla ve göster
        const formattedPrices = prices.map(price => {
          const formattedPrice = this.priceService.formatPrice(price);
          return `${formattedPrice}`;
        });
        
        // Sadece fiyat bilgilerini göster, başlık olmadan
        await ctx.reply(
          formattedPrices.join('\n'),
          { parse_mode: 'HTML' }
        );
        
        // Kullanıcı geçmişini güncelle
        try {
          await this.symbolService.updateUserHistory(userId, assetType);
        } catch (historyError) {
          this.logger.error(`Error updating history: ${historyError.message}`);
        }
      } catch (error) {
        this.logger.error(`Liste fiyatları alınırken hata: ${error.message}`);
        await ctx.reply(`"${list.listName}" listesi için fiyatlar alınırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.`);
      }
    } catch (error) {
      this.logger.error(`Text message handler error: ${error.message}`);
      // Hata durumunda sessizce devam et, kullanıcıya mesaj gösterme
    }
  }

  @Command('alerts')
  async handleAlertCommand(@Ctx() ctx: Context) {
    console.log('ALERTS KOMUTU ÇALIŞTIRILDI!');
    this.logger.debug(`Uyarı komutu çalıştırıldı, kullanıcı: ${ctx.from?.id}, mesaj: "${(ctx.message as any)?.text}"`);
    
    try {
      if (!ctx.message) return;
      
      const chatId = ctx.message.chat.id.toString();
      const messageText = (ctx.message as any)?.text || '';
      
      // Komutu parçalara ayır (/alerts yeni liste_adı gibi)
      const parts = messageText.split(' ');
      
      // Eğer komut parametresi yoksa, yardım mesajı göster
      if (parts.length === 1) {
        const userAlerts = await this.alertService.getUserAlertLists(chatId);
        
        if (userAlerts.length === 0) {
          await ctx.reply(
            'Henüz hiç uyarı listeniz yok.\n\n' +
            'Yeni uyarı listesi oluşturmak için: /alerts yeni <liste adı>\n' +
            'Örnek: /alerts yeni kripto'
          );
          return;
        }
        
        const listMessages = userAlerts.map(list => 
          `${list.isActive ? '🟢' : '🔴'} ${list.listName} (${list.symbolCount} sembol)`
        );
        
        let message = 'Uyarı Listeleriniz:\n\n' + 
          listMessages.join('\n') + 
          '\n\nBir uyarı listesini görüntülemek için: /alerts <liste adı>' +
          '\nYeni uyarı listesi oluşturmak için: /alerts yeni <liste adı>' +
          '\nListe silmek için: /alerts sil <liste adı>' +
          '\nListe durumu değiştirmek için: /alerts durum <liste adı>';
        
        await ctx.reply(message);
        return;
      }
      
      const action = parts[1].toLowerCase();
      
      // Yeni liste oluştur
      if (action === 'yeni' && parts.length >= 3) {
        const listName = parts.slice(2).join(' ');
        const success = await this.alertService.createAlertList(chatId, listName);
        
        if (success) {
          await ctx.reply(
            `✅ "${listName}" uyarı listesi oluşturuldu.\n\n` +
            `Listeye sembol eklemek için: /alertsadd ${listName} <sembol>\n` +
            `Örnek: /alertsadd ${listName} ${listName === 'kripto' ? 'BTC ETH' : 'THYAO ASELS'}`
          );
        } else {
          await ctx.reply(`"${listName}" uyarı listesi oluşturulamadı. Bu isimde bir liste zaten var olabilir.`);
        }
        return;
      }
      
      // Listeyi sil
      if (action === 'sil' && parts.length >= 3) {
        const listName = parts.slice(2).join(' ');
        const success = await this.alertService.deleteAlertList(chatId, listName);
        
        if (success) {
          await ctx.reply(`"${listName}" uyarı listesi silindi.`);
        } else {
          await ctx.reply(`"${listName}" uyarı listesi bulunamadı.`);
        }
        return;
      }
      
      // Liste durumunu değiştir (aktif/pasif)
      if (action === 'durum' && parts.length >= 3) {
        const listName = parts.slice(2).join(' ');
        const details = await this.alertService.getAlertListDetails(chatId, listName);
        
        if (!details) {
          await ctx.reply(`"${listName}" uyarı listesi bulunamadı.`);
          return;
        }
        
        const newStatus = !details.isActive;
        const success = await this.alertService.toggleAlertList(chatId, listName, newStatus);
        
        if (success) {
          const statusText = newStatus ? 'aktifleştirildi' : 'devre dışı bırakıldı';
          await ctx.reply(`"${listName}" uyarı listesi ${statusText}.`);
        } else {
          await ctx.reply(`"${listName}" uyarı listesi durumu değiştirilemedi.`);
        }
        return;
      }
      
      // Liste detaylarını göster
      const listName = parts.slice(1).join(' ').toLowerCase();
      const details = await this.alertService.getAlertListDetails(chatId, listName);
      
      if (!details) {
        await ctx.reply(`"${listName}" uyarı listesi bulunamadı.`);
        return;
      }
      
      // Liste boşsa bilgi ver
      if (details.symbols.length === 0) {
        await ctx.reply(
          `"${listName}" uyarı listesi boş.\n\n` +
          `Durum: ${details.isActive ? '🟢 Aktif' : '🔴 Pasif'}\n` +
          `Varsayılan fiyat değişim eşiği: %${details.percentChangeThreshold}\n\n` +
          `Listeye sembol eklemek için: /alertsadd ${listName} <sembol>\n` +
          `Örnek: /alertsadd ${listName} ${listName === 'borsa' ? 'THYAO' : 'BTC'}`
        );
        return;
      }
      
      // Liste adına göre asset tipini belirle
      const assetType = listName === 'borsa' ? 'stock' : 'crypto';
      this.logger.debug(`"${listName}" uyarı listesi için '${assetType}' tipi kullanılıyor`);
      
      // Listedeki semboller için fiyat bilgilerini al - liste adına göre tip belirle
      const prices = await this.priceService.getPrices(details.symbols, assetType);
      
      // Her sembol için eşik değerleri ve fiyat bilgilerini hazırla
      const formattedInfos = prices.map(price => {
        const symbol = price.symbol;
        const formattedPrice = this.priceService.formatPrice(price);
        // Sembol için özel eşik değeri varsa onu kullan, yoksa liste eşiğini kullan
        const threshold = details.highThresholds.get(symbol) || details.percentChangeThreshold;
        return `${formattedPrice} (Eşik: %${threshold})`;
      });
      
      const statusText = details.isActive ? '🟢 Aktif' : '🔴 Pasif';
      const lastCheckText = details.lastCheckTime 
        ? `Son kontrol: ${new Date(details.lastCheckTime).toLocaleString('tr-TR')}`
        : 'Henüz kontrol edilmedi';
      
      const message = 
        `"${listName}" Uyarı Listesi\n` +
        `Durum: ${statusText}\n` +
        `Varsayılan fiyat değişim eşiği: %${details.percentChangeThreshold}\n` +
        `${lastCheckText}\n\n` +
        `${formattedInfos.join('\n')}`;
      
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error(`Error in alert command: ${error.message}`);
      await ctx.reply('Uyarı işlemlerinde bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }

  @Action(/alert_symbol:(.+):(.+):(.+)/)
  async handleAlertSymbolSelection(@Ctx() ctx: Context) {
    if (!ctx.callbackQuery) return;
    
    const chatId = ctx.callbackQuery.from.id.toString();
    
    // Callback verisini parçala
    const callbackData = (ctx.callbackQuery as any).data;
    const match = callbackData.match(/alert_symbol:(.+):(.+):(.+)/);
    
    if (!match || match.length < 4) {
      await ctx.answerCbQuery('İşlem yapılamadı');
      return;
    }
    
    const symbol = match[1];
    const listName = match[2];
    const thresholdPercent = parseFloat(match[3]);
    
    // Sembolü uyarı listesine ekle
    const success = await this.alertService.addSymbolToAlertList(
      chatId, 
      listName, 
      symbol, 
      thresholdPercent
    );
    
    if (success) {
      await ctx.editMessageText(
        `"${symbol}" sembolü "${listName}" uyarı listesine eklendi.\n` +
        `Fiyat değişim eşiği: %${thresholdPercent}`
      );
    } else {
      await ctx.editMessageText(`"${symbol}" sembolü uyarı listesine eklenemedi. Liste bulunamadı.`);
    }
    
    await ctx.answerCbQuery();
  }

  @Action(/create_quick_list:(.+):(.+):(.+)/)
  async handleQuickListCreation(@Ctx() ctx: Context) {
    if (!ctx.callbackQuery) return;
    
    // Callback verisini parçala
    const callbackData = (ctx.callbackQuery as any).data;
    const match = callbackData.match(/create_quick_list:(.+):(.+):(.+)/);
    
    if (!match || match.length < 4) {
      await ctx.answerCbQuery('İşlem yapılamadı');
      return;
    }
    
    const listName = match[1];
    const symbol = match[2];
    const chatId = match[3];
    
    try {
      // Önce liste var mı kontrol et
      const listExists = await this.alertService.doesAlertListExist(chatId, listName);
      
      if (listExists) {
        // Liste zaten varsa, doğrudan sembolü ekle
        this.logger.debug(`"${listName}" listesi zaten var, sembol eklemeye çalışılıyor`);
        const symbolAdded = await this.alertService.addSymbolToAlertList(
          chatId,
          listName,
          symbol,
          5 // Varsayılan eşik
        );
        
        if (symbolAdded) {
          await ctx.editMessageText(
            `✅ "${symbol}" sembolü mevcut "${listName}" listesine eklendi!\n\n` +
            `• Listeyi görüntülemek için: /alerts ${listName}\n` +
            `• Fiyat değişim eşiği: %5\n` +
            `• Daha fazla sembol eklemek için: /alertsadd ${listName} <sembol1> <sembol2> ...`
          );
        } else {
          await ctx.editMessageText(
            `❌ "${symbol}" sembolü "${listName}" listesine eklenemedi.\n` +
            `Bu sembol zaten listede olabilir.`
          );
        }
        
        await ctx.answerCbQuery(`Sembol listeye eklendi`);
        return;
      }
      
      // Liste yoksa yeni oluştur
      const listCreated = await this.alertService.createAlertList(chatId, listName);
      
      if (!listCreated) {
        await ctx.editMessageText(
          `❗️ "${listName}" listesi oluşturulamadı.\n` +
          `Lütfen daha sonra tekrar deneyin.`
        );
        await ctx.answerCbQuery(`Liste oluşturulamadı`);
        return;
      }
      
      // Sembolü ekle (varsayılan %5 eşikle)
      const symbolAdded = await this.alertService.addSymbolToAlertList(
        chatId,
        listName,
        symbol,
        5 // Varsayılan eşik
      );
      
      if (symbolAdded) {
        await ctx.editMessageText(
          `✅ "${listName}" listesi oluşturuldu ve "${symbol}" sembolü eklendi!\n\n` +
          `• Listeyi görüntülemek için: /alerts ${listName}\n` +
          `• Fiyat değişim eşiği: %5\n` +
          `• Daha fazla sembol eklemek için: /alertsadd ${listName} <sembol1> <sembol2> ...`
        );
      } else {
        await ctx.editMessageText(
          `✅ "${listName}" listesi oluşturuldu, fakat "${symbol}" sembolü eklenemedi.\n` +
          `Sembol eklemek için: /alertsadd ${listName} ${symbol}`
        );
      }
      
      await ctx.answerCbQuery(`Liste oluşturuldu`);
    } catch (error) {
      this.logger.error(`Hızlı liste oluşturma hatası: ${error.message}`);
      await ctx.editMessageText('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      await ctx.answerCbQuery('İşlem başarısız');
    }
  }

  @Action(/create_symbol_list:(.+):(.+):(.+)/)
  async handleSymbolListCreation(@Ctx() ctx: Context) {
    if (!ctx.callbackQuery) return;
    
    // Callback verisini parçala
    const callbackData = (ctx.callbackQuery as any).data;
    const match = callbackData.match(/create_symbol_list:(.+):(.+):(.+)/);
    
    if (!match || match.length < 4) {
      await ctx.answerCbQuery('İşlem yapılamadı');
      return;
    }
    
    const listName = match[1];
    const symbol = match[2];
    const userId = match[3];
    
    try {
      // Önce liste var mı kontrol et
      const list = await this.symbolService.getListDetails(userId, listName);
      
      if (list) {
        // Liste zaten varsa, doğrudan sembolü ekle
        this.logger.debug(`"${listName}" listesi zaten var, sembol eklemeye çalışılıyor`);
        const symbolAdded = await this.symbolService.addSymbolToList(userId, listName, symbol);
        
        if (symbolAdded) {
          await ctx.editMessageText(
            `✅ "${symbol}" sembolü mevcut "${listName}" listesine eklendi!\n\n` +
            `• Listeyi görüntülemek için: /liste ${listName}\n` +
            `• Daha fazla sembol eklemek için: /ekle ${listName} <sembol1> <sembol2> ...`
          );
        } else {
          await ctx.editMessageText(
            `❌ "${symbol}" sembolü "${listName}" listesine eklenemedi.\n` +
            `Bu sembol zaten listede olabilir.`
          );
        }
        
        await ctx.answerCbQuery(`Sembol listeye eklendi`);
        return;
      }
      
      // Liste yoksa yeni oluştur
      const listCreated = await this.symbolService.createUserList(userId, listName);
      
      if (!listCreated) {
        await ctx.editMessageText(
          `❗️ "${listName}" listesi oluşturulamadı.\n` +
          `Lütfen daha sonra tekrar deneyin.`
        );
        await ctx.answerCbQuery(`Liste oluşturulamadı`);
        return;
      }
      
      // Sembolü ekle
      const symbolAdded = await this.symbolService.addSymbolToList(userId, listName, symbol);
      
      if (symbolAdded) {
        await ctx.editMessageText(
          `✅ "${listName}" listesi oluşturuldu ve "${symbol}" sembolü eklendi!\n\n` +
          `• Listeyi görüntülemek için: /liste ${listName}\n` +
          `• Daha fazla sembol eklemek için: /ekle ${listName} <sembol1> <sembol2> ...`
        );
      } else {
        await ctx.editMessageText(
          `✅ "${listName}" listesi oluşturuldu, fakat "${symbol}" sembolü eklenemedi.\n` +
          `Sembol eklemek için: /ekle ${listName} ${symbol}`
        );
      }
      
      await ctx.answerCbQuery(`Liste oluşturuldu`);
    } catch (error) {
      this.logger.error(`Sembol listesi oluşturma hatası: ${error.message}`);
      await ctx.editMessageText('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
      await ctx.answerCbQuery('İşlem başarısız');
    }
  }

  // Data komutunu ekle
  @Command('data')
  async handleDataCommand(@Ctx() ctx: Context) {
    try {
      if (!ctx.message) return;
      
      const chatId = ctx.message.chat.id.toString();
      const userId = (ctx.message as any).from.id.toString();
      const messageText = (ctx.message as any)?.text || '';
      const parts = messageText.split(' ').filter(p => p.trim() !== '');
      
      // İşlem gönderen kişinin ID'sini debug için logla
      this.logger.log(`Data komutunu kullanan kullanıcı: chatId=${chatId}, userId=${userId}`);
      this.logger.log(`Mevcut admin listesi: ${process.env.ADMIN_USERS}`);
      
      // Admin kontrolü - hem userId hem de chatId kontrolü yapalım 
      const adminUsers = process.env.ADMIN_USERS ? process.env.ADMIN_USERS.split(',') : [];
      const isAdmin = adminUsers.includes(userId) || adminUsers.includes(chatId);
      
      if (!isAdmin) {
        this.logger.log(`Admin olmayan kullanıcı: ${userId}`);
        await ctx.reply('Bu komut sadece bot yöneticileri tarafından kullanılabilir.');
        return;
      }
      
      // Admin doğrulandı, işleme devam et
      this.logger.log(`Admin doğrulandı: ${userId}, işleme devam ediliyor...`);
      
      // Yeterli parametre var mı? (/data [borsa|kripto] symbol1 symbol2...)
      if (parts.length < 3) {
        await ctx.reply(
          'Veritabanına sembol eklemek için komut formatı:\n' +
          '/data borsa SYMBOL1 SYMBOL2 ... (Hisse senetleri için)\n' +
          '/data kripto SYMBOL1 SYMBOL2 ... (Kripto paralar için)\n' +
          'Örnek: /data borsa THYAO ASELS SASA\n' +
          'Örnek: /data kripto BTC ETH SOL'
        );
        return;
      }
      
      const dataType = parts[1].toLowerCase();
      
      // Geçerli veri tipi kontrolü
      if (dataType !== 'borsa' && dataType !== 'kripto') {
        await ctx.reply('Lütfen geçerli bir veri tipi belirtin: "borsa" veya "kripto"');
        return;
      }
      
      // Sembolleri temizle ve büyük harfe çevir
      const symbols = parts.slice(2).map(s => s.trim().toUpperCase());
      
      if (symbols.length === 0) {
        await ctx.reply('Lütfen en az bir sembol belirtin.');
        return;
      }
      
      this.logger.log(`İşlenecek semboller: ${symbols.join(', ')}`);
      
      // Başarılı ve başarısız eklemeleri takip et
      const results: { symbol: string, success: boolean, reason?: string }[] = [];
      
      // Sembollerin her birini veritabanına ekle
      for (const symbol of symbols) {
        try {
          // Sembol türünü belirle
          const symbolType = dataType === 'borsa' ? 'stock' : 'crypto';
          
          // Sembol adını oluştur (varsayılan)
          const symbolName = `${symbol} ${symbolType === 'stock' ? 'Hisse Senedi' : 'Kripto Para'}`;
          
          // Sembol verisi oluştur
          const symbolData = {
            symbol,
            type: symbolType as 'stock' | 'crypto',
            name: symbolName,
            aliases: [symbol.toLowerCase()], // Alternatif isimler eklenebilir
            popularity: 50 // Orta düzey popülerlik
          };
          
          // Veritabanına ekle
          await this.symbolService.addOrUpdateSymbol(symbolData);
          
          results.push({
            symbol,
            success: true
          });
          
          this.logger.log(`Sembol başarıyla eklendi: ${symbol}`);
        } catch (error) {
          this.logger.error(`Sembol ekleme hatası (${symbol}): ${error.message}`);
          
          results.push({
            symbol,
            success: false,
            reason: error.message
          });
        }
      }
      
      // Sonuç mesajını oluştur
      const successSymbols = results.filter(r => r.success).map(r => r.symbol);
      const failedSymbols = results.filter(r => !r.success).map(r => r.symbol);
      
      let responseMessage = `📊 Veritabanı Güncelleme Sonucu (${dataType.toUpperCase()}):\n\n`;
      
      if (successSymbols.length > 0) {
        responseMessage += `✅ Başarıyla eklenen semboller (${successSymbols.length}):\n${successSymbols.join(', ')}\n\n`;
      }
      
      if (failedSymbols.length > 0) {
        responseMessage += `❌ Eklenemeyen semboller (${failedSymbols.length}):\n${failedSymbols.join(', ')}`;
      }
      
      this.logger.log(`İşlem tamamlandı, cevap gönderiliyor: ${responseMessage}`);
      
      await ctx.reply(responseMessage);
      
    } catch (error) {
      this.logger.error(`Data komut hatası: ${error.message}`, error.stack);
      await ctx.reply('Bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
    }
  }

  // Fiyat bilgisini formatla (çeşitli biçimlendirme seçenekleri)
  private formatPriceForDisplay(price: AssetPrice): string {
    const { symbol, price: priceValue, percentChange24h, name, source, type } = price;
    
    // Fiyat formatlaması
    let priceFormatted: string;
    if (priceValue >= 1000) {
      priceFormatted = priceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else if (priceValue >= 1) {
      priceFormatted = priceValue.toFixed(2);
    } else if (priceValue >= 0.01) {
      priceFormatted = priceValue.toFixed(4);
    } else if (priceValue >= 0.0001) {
      priceFormatted = priceValue.toFixed(6);
    } else {
      priceFormatted = priceValue.toFixed(8);
    }
    
    // 24 saatlik değişim formatlaması
    const changePrefix = percentChange24h >= 0 ? '🟢 +' : '🔴 ';
    const changeValue = `${changePrefix}${percentChange24h.toFixed(2)}%`;
    
    // Gösterilecek sembol (varsa ek bilgilerle)
    let displaySymbol = symbol;
    if (displaySymbol.endsWith('.IS')) {
      displaySymbol = displaySymbol.replace('.IS', '');
    }
    
    // Varsayılan tip: crypto
    const actualType = type || 'crypto';
    const typeEmoji = actualType === 'crypto' ? '🔹' : '📈';
    const nameInfo = name && name !== symbol ? ` (${name})` : '';
    
    return `${typeEmoji} ${displaySymbol}${nameInfo}: $${priceFormatted} ${changeValue}`;
  }
} 