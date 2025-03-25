import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectBot, Start, Help, Command, On, Ctx, Update, Action } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';
import { CmcService } from '../cmc/cmc.service';
import { PriceService } from '../price/price.service';
import { SymbolService, SymbolSearchResult } from '../symbol/symbol.service';
import { BinanceService } from '../binance/binance.service';
import { AlertService } from '../alert/alert.service';

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

    this.bot.command('alertadd', async (ctx) => {
      console.log('ALERTADD KOMUTU ÇALIŞTIRILDI!');
      try {
        if (!ctx.message) return;
        
        const chatId = ctx.message.chat.id.toString();
        const messageText = (ctx.message as any)?.text || '';
        
        // Komutu parçalara ayır (/alertadd liste_adı sembol)
        const parts = messageText.split(' ');
        
        if (parts.length < 3) {
          await ctx.reply(
            'Lütfen bir liste adı ve en az bir sembol belirtin.\n' +
            'Örnek: /alertadd kripto BTC\n' +
            'Çoklu sembol: /alertadd kripto BTC ETH PEPE\n' +
            'Farklı eşikler: /alertadd kripto BTC 1 ETH 3 PEPE 5'
          );
          return;
        }
        
        const listName = parts[1];
        const remainingParts = parts.slice(2);
        
        // Başarıyla eklenen semboller
        const addedSymbols: { symbol: string, threshold: number }[] = [];
        
        // 1. Senaryo: /alertadd kripto btc 1 pepe 3 eth 5
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
        // 2. Senaryo: /alertadd kripto btc eth pepe
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
          await ctx.reply(`"${listName}" uyarı listesine hiçbir sembol eklenemedi. Liste bulunamadı veya semboller geçersiz.`);
        }
      } catch (error) {
        console.error('Alertadd komutu hatası:', error);
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
  }

  /**
   * Bot başlangıç metodu
   */
  async onModuleInit() {
    const botInfo = await this.bot.telegram.getMe();
    this.logger.log(`Bot başlatıldı! @${botInfo.username} adıyla çalışıyor.`);
    
    // Komutları tanımla - gruplar için
    try {
      const commands = [
        { command: 'l', description: 'Yeni liste oluştur' },
        { command: 'liste', description: 'Yeni liste oluştur' },
        { command: 'ekle', description: 'Listeye sembol ekle' },
        { command: 'add', description: 'Listeye sembol ekle' },
        { command: 'cikar', description: 'Listeden sembol çıkar' },
        { command: 'listeler', description: 'Tüm listeleri göster' },
        { command: 'lists', description: 'Tüm listeleri göster' },
        { command: 'listedetay', description: 'Liste detaylarını göster' },
        { command: 'fiyat', description: 'Fiyat göster' },
        { command: 'alerts', description: 'Uyarı listelerini göster' },
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
      { cmd: '/alertadd', desc: 'Uyarı listesine sembol ekle, örn: /alertadd liste_adı btc 5' },
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
        await ctx.reply(`"${listName}" adında bir listeniz yok. Önce listeyi oluşturun:\n/liste yeni ${listName}`);
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
            `"${listName}" uyarı listesi oluşturuldu.\n\n` +
            `Listeye sembol eklemek için: /alertadd ${listName} <sembol>\n` +
            `Örnek: /alertadd ${listName} BTC`
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
      const listName = parts.slice(1).join(' ');
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
          `Listeye sembol eklemek için: /alertadd ${listName} <sembol>\n` +
          `Örnek: /alertadd ${listName} BTC`
        );
        return;
      }
      
      // Listedeki semboller için fiyat bilgilerini al
      const prices = await this.priceService.getPrices(details.symbols, 'crypto');
      
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
} 