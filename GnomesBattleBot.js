require('dotenv').config();
const fs = require('fs');
const { ethers} = require('ethers');
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.MAIN_BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });
const battleContractAddress = '0x4FF4dd60888F9D640b49ec71662Ca9C000E76124';
const hungerGamesAddress = '0xc4797381163C492159C30c1d42E633EC0b372006';
const GnomesCollectiveAddress = '0x2391C069B5262E5c1aC2dfD84b09743a91657239';

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
const battleContractABI = JSON.parse(fs.readFileSync('./ABI/BattleContract.json', 'utf8')).abi;
const tokenContractABI = JSON.parse(fs.readFileSync('./ABI/HungerGames.json', 'utf8')).abi;
const battleContract = new ethers.Contract(battleContractAddress, battleContractABI, provider);
const tokenContract = new ethers.Contract(hungerGamesAddress, tokenContractABI, provider);

const userTimestamps = {};
const RATE_LIMIT = 1 * 10 * 1000;

bot.onText(/\/?nft ([\d,]+)/i, async (msg, match) => {
    const userId = msg.from.id;
    const currentTime = Date.now();
    if (userTimestamps[userId] && (currentTime - userTimestamps[userId] < RATE_LIMIT)) {
        bot.sendMessage(msg.chat.id, `${safeUsername} Please wait 10 seconds before using a command again. Alternatively, you can use /nft with up to 10 IDs at once (e.g., /nft ID1, ID2, ...).`);
        return;
    }
    userTimestamps[userId] = currentTime;

    const chatId = msg.chat.id;
    let nftIds = match[1].split(',').map(id => Number(id.trim()));

    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const safeUsername = username.replace(/_/g, '\\_');

    if (nftIds.length > 10) {
        nftIds = nftIds.slice(0, 10);  // Limit to the first 10 NFT IDs
        bot.sendMessage(chatId, `${safeUsername}, You provided more than 10 NFT IDs. I'll only process the first 10.`, { parse_mode: 'Markdown' });
    }

    for (let nftId of nftIds) {
        if (nftId === 0 || nftId > 2888) {
            bot.sendMessage(chatId, `${safeUsername},\n NFT with ID ${nftId} doesn't exist.`, { parse_mode: 'Markdown' });
            continue;
        }

        try {
            const isDead = await battleContract.dead(nftId);
            const battleDetail = await battleContract.getBattleDetail(nftId);

            let message = `${safeUsername}, `;
            if (isDead) {
                message += `The NFT with ID ${nftId} is dead.\n\n`;
            } else {
                message += `The NFT with ID ${nftId} is alive.\n\n`;
            }

            if (battleDetail.opponentId == 0) {
                message += `This NFT has not participated in a battle yet.\n`;
            } else {
                message += `Last Battle Details:\n`;
                message += `- Opponent ID: ${battleDetail.opponentId}\n`;

                const resultText = battleDetail.result === 0 ? 'Won' :
                                   battleDetail.result === 1 ? 'Lost' : 'Skipped';
                message += `- Result: ${resultText}\n`;

                message += `- Used XTRA: ${battleDetail.usedXTRA ? 'Yes' : 'No'}\n`;
                message += `- Used BOOST: ${battleDetail.usedBOOST ? 'Yes' : 'No'}\n`;
                message += `- Used V: ${battleDetail.usedV ? 'Yes' : 'No'}\n`;
                message += `- Used SKIP: ${battleDetail.usedSKIP ? 'Yes' : 'No'}`;
            }

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            bot.sendMessage(chatId, `${safeUsername}, Error fetching details for NFT ${nftId}. Please try again later.`, { parse_mode: 'Markdown' });
            console.error(error);
        }
    }
});

bot.onText(/\/?leaderboard/i, async (msg) => {
    const chatId = msg.chat.id;
    
    // Extract username or first name from the message sender
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const safeUsername = username.replace(/_/g, '\\_'); // Escape underscores for Markdown
  
    try {
        const aliveArray = await battleContract.getAliveByID();

        const roundWinsPromises = aliveArray.map(id => battleContract.roundWinsOfNFT(id));
        const roundWinsArray = await Promise.all(roundWinsPromises);

        const sortedAliveArray = [...aliveArray].sort((a, b) => {
            const indexA = aliveArray.indexOf(a);
            const indexB = aliveArray.indexOf(b);
            return roundWinsArray[indexB] - roundWinsArray[indexA];
        });
        
        const top30 = sortedAliveArray.slice(0, 30);

        let responseTitle = `${safeUsername}, \n`;
        if (top30.length <= 5) {
            responseTitle += '*WINNERS OF LAST GAME*\n\n';
        } else {
            responseTitle += '*TOP 30 ALIVE NFTs*\n\n';
        }

        const medals = ['🥇', '🥈', '🥉'];

        const response = top30.map((id, index) => {
            const medal = medals[index] || '';
            const roundWins = roundWinsArray[aliveArray.indexOf(id)];
            return medal
                ? `${medal} ID: ${id} - Game Wins: ${roundWins}`
                : `${index + 1}. ID: ${id} - Game Wins: ${roundWins}`;
        }).join('\n');
        
        bot.sendMessage(chatId, responseTitle + response, { parse_mode: 'Markdown' });
  
    } catch (error) {
        bot.sendMessage(chatId, `${safeUsername}, Error fetching leaderboard. Please try again later.`, { parse_mode: 'Markdown' });
        console.error(error);
    }
});

bot.onText(/\/?ca/i, (msg) => {
    const chatId = msg.chat.id;
    
    // Extract username or first name from the message sender
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const safeUsername = username.replace(/_/g, '\\_'); // Escape underscores for Markdown
  
    let replyText = `${safeUsername},\n here are the *Smart Contract Addresses:*\n\n`;
    
    replyText += "🛡️ *Battle Contract:*\n";
    replyText += `\`${battleContractAddress}\`\n\n`;
    
    replyText += "💰 *$HGMS Token:*\n";
    replyText += `\`${hungerGamesAddress}\`\n\n`;
    
    replyText += "🎨 *NFT Contract:*\n";
    replyText += `\`${GnomesCollectiveAddress}\`\n`;
  
    bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
});

bot.onText(/\/?time/i, async (msg) => {
    const userId = msg.from.id;
    const currentTime = Date.now();

    if (userTimestamps[userId] && (currentTime - userTimestamps[userId] < RATE_LIMIT)) {
        bot.sendMessage(msg.chat.id, `Please wait for 10 seconds before using a command again.`);
        return;
    }
    userTimestamps[userId] = currentTime;
    const chatId = msg.chat.id;

  try {
      console.log("Fetching game state from the contract...");

      // Fetching game state from the contract
      const newGame = await battleContract.newGame();
      console.log("newGame:", newGame);

      const HungerGamesBegin = await battleContract.HungerGamesBegin();
      console.log("HungerGamesBegin:", HungerGamesBegin);

      const timerPassed = await battleContract.hasTimerPassed();
      console.log("timerPassed:", timerPassed);

      const roundsCount = await battleContract.roundsCount();
      console.log("roundsCount:", roundsCount);

      const currentTime = Math.floor(Date.now() / 1000);
      console.log("currentTime:", currentTime);

      const startTimer = await battleContract._startTimer();
      console.log("startTimer:", startTimer);

      let intervalTime = await battleContract.roundDuration();
      console.log("intervalTime:", intervalTime);

      let notificationMessage;

      const roundsCountNum = roundsCount.toNumber();  // I assume you meant to convert 'roundsCount' to a number first before adding 1
      console.log("Converted roundsCount:", roundsCountNum);
      
      const startTimerNum = startTimer.toNumber();
      console.log("Converted startTimer:", startTimerNum);
      
      let intervalTimeNum = intervalTime.toNumber();
      console.log("Converted intervalTime:", intervalTimeNum);
      
      if (newGame) {
        intervalTimeNum = intervalTimeNum * 6;
          notificationMessage = `🚀 ${safeUsername}, New Hunger Games will begin in `;
          console.log("Setting interval for new game:", intervalTimeNum);
      } else if (!newGame && HungerGamesBegin) {
          notificationMessage = `⏱️ ${safeUsername},  The next round will begin in `;
          console.log("Setting interval for next round:", intervalTime);
      }
      console.log("Converted new intervalTime:", intervalTimeNum);
      const remainingTime = startTimerNum + intervalTimeNum - currentTime;
      console.log("remainingTime:", remainingTime);

      const minutes = Math.floor(remainingTime / 60);
      const seconds = remainingTime % 60;
      console.log("Computed minutes and seconds:", minutes, seconds);

      // Sending appropriate messages based on game state
      if (timerPassed) {
          bot.sendMessage(chatId, `🚀The timer has passed! The Hunger Games or round has begun or will begin shortly!`);
      } else if (remainingTime > 0) {
          bot.sendMessage(chatId, notificationMessage + `${minutes}:${seconds.toString().padStart(2, '0')} minutes!`);
      } else {
          bot.sendMessage(chatId, `🚀The Hunger Games or round has begun!`);
      }

      if (newGame) {
        bot.sendMessage(chatId, `Currently, in round 0.`);
    } else {
        bot.sendMessage(chatId, `Currently, in round ${roundsCountNum}.`);
    }
    
      
  } catch (error) {
      bot.sendMessage(chatId, 'Error fetching game timing. Please try again later.');
      console.error("Error in the /time command:", error);
  }
});

bot.onText(/\/?stats ([\d,]+)/i, async (msg, match) => {
    const userId = msg.from.id;
    const currentTime = Date.now();
    const mintAmount = await battleContract.getMintAmount();
    if (userTimestamps[userId] && (currentTime - userTimestamps[userId] < RATE_LIMIT)) {
        bot.sendMessage(msg.chat.id, "Please wait for 10 seconds before using a command again. Alternatively, you can use /stats with up to 10 IDs at once (e.g., /stats ID1, ID2, ...).");
        return;
    }
    userTimestamps[userId] = currentTime;

    const chatId = msg.chat.id;
    let nftIds = match[1].split(',').map(id => Number(id.trim()));

    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const safeUsername = username.replace(/_/g, '\\_');

    if (nftIds.length > 10) {
        nftIds = nftIds.slice(0, 10);  // Limit to the first 10 NFT IDs
        bot.sendMessage(chatId, `${safeUsername},\n You provided more than 10 NFT IDs. I'll only process the first 10.`, { parse_mode: 'Markdown' });
    }

    for (let nftId of nftIds) {
        if (nftId <= 0 || nftId > mintAmount) {
            bot.sendMessage(chatId, `${safeUsername}, NFT with ID ${nftId} doesn't exist.`, { parse_mode: 'Markdown' });
            continue;
        }

        try {
            const hp = await battleContract.stats(nftId, 0);
            const attack = await battleContract.stats(nftId, 1);
            const defense = await battleContract.stats(nftId, 2);
            const intellect = await battleContract.stats(nftId, 3);
            const special = await battleContract.stats(nftId, 4);
            
            const battleWins = await battleContract.battleWinsOfNFT(nftId);
            const battleLosses = await battleContract.battleLossOfNFT(nftId);
            const roundWins = await battleContract.roundWinsOfNFT(nftId);
            const totalPotionsUsed = await tokenContract.potionsUsed(nftId);

            let message = `${safeUsername}, 📊 *Fight Stats for NFT ${nftId}:*\n\n`;
            message += `- HP: ${hp.toString()}\n`;
            message += `- Attack: ${attack.toString()}\n`;
            message += `- Defense: ${defense.toString()}\n`;
            message += `- Intellect: ${intellect.toString()}\n`;
            message += `- Special: ${special.toString()}\n\n`;
            
            message += `🏆 *Battle Record for NFT ${nftId}:*\n\n`;
            message += `- Wins: ${battleWins.toString()}\n`;
            message += `- Losses: ${battleLosses.toString()}\n`;
            message += `- Game Wins: ${roundWins.toString()}\n\n`;
            
            message += `🧪 *Potions Usage for NFT ${nftId}:*\n\n`;
            message += `- Total Potions Used: ${totalPotionsUsed.toString()}`;

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        } catch (error) {
            bot.sendMessage(chatId, `${safeUsername}, Error fetching stats for NFT ${nftId}. Please try again later.`, { parse_mode: 'Markdown' });
            console.error(error);
        }
    }
});








