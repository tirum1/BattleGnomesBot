require('dotenv').config();
const fs = require('fs');
const { ethers} = require('ethers');
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.MAIN_BOT_TOKEN;

const bot = new TelegramBot(token, { polling: true });
const hungerGamesAddress = '0xfaAEFD5D384113d4b87D5eE41c5DD4c28329697f';
const GnomesCollectiveAddress = "0xF447E3a627F924EA8b064724001C484fEB39F6f9";

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
const tokenContractABI = JSON.parse(fs.readFileSync('./ABI/HungerGames.json', 'utf8')).abi;
const NFTContractABI = JSON.parse(fs.readFileSync('./ABI/GnomesCollective.json', 'utf8')).abi;
const tokenContract = new ethers.Contract(hungerGamesAddress, tokenContractABI, provider);
const NFTContract = new ethers.Contract(GnomesCollectiveAddress, tokenContractABI, provider);

const userTimestamps = {};
const RATE_LIMIT = 1 * 10 * 1000;

bot.onText(/\/?nft ([\d,]+)/i, async (msg, match) => {
    const userId = msg.from.id;
    const currentTime = Date.now();
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const safeUsername = username.replace(/_/g, '\\_');
    if (userTimestamps[userId] && (currentTime - userTimestamps[userId] < RATE_LIMIT)) {
        bot.sendMessage(msg.chat.id, `${safeUsername} Please wait 10 seconds before using a command again. Alternatively, you can use /nft with up to 10 IDs at once (e.g., /nft ID1, ID2, ...).`, { parse_mode: 'Markdown' });
        return;
    }
    userTimestamps[userId] = currentTime;

    const chatId = msg.chat.id;
    let nftIds = match[1].split(',').map(id => Number(id.trim()));

    

    if (nftIds.length > 10) {
        nftIds = nftIds.slice(0, 10);  
        bot.sendMessage(chatId, `${safeUsername}, You provided more than 10 NFT IDs. I'll only process the first 10.`, { parse_mode: 'Markdown' });
    }

    for (let nftId of nftIds) {
        if (nftId === 0 || nftId > 2888) {
            bot.sendMessage(chatId, `${safeUsername},\n NFT with ID ${nftId} doesn't exist.`, { parse_mode: 'Markdown' });
            continue;
        }

        try {
            const retrievedDead = await getAsync("dead"); 
            let isDead = false; 

            if (retrievedDead) {
                const parsedDead = JSON.parse(retrievedDead);

                if (Array.isArray(parsedDead)) {
                    isDead = parsedDead.some(entry => Array.isArray(entry) && entry.length === 2 && entry[0] === nftId && entry[1] === true);
                }
            }

            const keyName = `${nftId}BattleResult`; 
            const battleDetailData = await getAsync(keyName); 

            let battleDetail = null; 

            if (battleDetailData) {
                battleDetail = JSON.parse(battleDetailData);
            }


            let message = `${safeUsername}\n`;

            if (isDead) {
                message += `😵 The NFT with ID ${nftId} is no longer among the living.\n`;
            } else {
                message += `🌿 The NFT with ID ${nftId} is alive and well!\n`;
            }

            if (!battleDetailData) {
                message += `🛡️ This NFT hasn't entered any battles yet.\n`;
            } else {
                message += `Last Battle Details:\n`;
                message += `👥 Opponent ID: ${battleDetail.opponentId}\n`;

                const resultText = battleDetail.result === 0 ? 'Victory' :
                                battleDetail.result === 1 ? 'Defeat' : 'No Contest';
                message += `🏆 Result: ${resultText}\n`;

                message += `💥 Used XTRA: ${battleDetail.usedXTRA ? 'Yes' : 'No'}\n`;
                message += `⚡ Used BOOST: ${battleDetail.usedBOOST ? 'Yes' : 'No'}\n`;
                message += `✨ Used V: ${battleDetail.usedV ? 'Yes' : 'No'}\n`;
                message += `⏭️ Used SKIP: ${battleDetail.usedSKIP ? 'Yes' : 'No'}`;
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
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const safeUsername = username.replace(/_/g, '\\_');

    try {
        const aliveArrayData = await getAsync("aliveByID"); 
        const roundWinsArrayPromises = aliveArrayData.map(id => getAsync(`RoundWinsOf${id}`)); 
        const roundWinsArray = await Promise.all(roundWinsArrayPromises);

        const sortedAliveArray = aliveArrayData.sort((a, b) => {
            const roundWinsA = parseInt(roundWinsArray[aliveArrayData.indexOf(a)]) || 0;
            const roundWinsB = parseInt(roundWinsArray[aliveArrayData.indexOf(b)]) || 0;
            return roundWinsB - roundWinsA;
        });

        const top30 = sortedAliveArray.slice(0, 30);

        let responseTitle = `${safeUsername} \n`;
        if (top30.length === 0) {
            responseTitle = 'GAMES NOT STARTED YET';
        } else {
            if (top30.length <= 5) {
                responseTitle += '*WINNERS OF LAST GAME*\n\n';
            } else {
                responseTitle += '*TOP 30 ALIVE NFTs*\n\n';
            }
        }

        const medals = ['🥇', '🥈', '🥉'];

        const response = top30.map((id, index) => {
            const medal = medals[index] || '';
            const roundWins = parseInt(roundWinsArray[aliveArrayData.indexOf(id)]) || 0;
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
  
    let replyText = `${safeUsername}\n here are the *Smart Contract Addresses:*\n\n`;

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
        console.log("Fetching game state from Redis...");

        const newGame = await getAsync("newGame");
        console.log("newGame:", newGame);

        const HungerGamesBegin = await getAsync("HungerGamesBegin");
        console.log("HungerGamesBegin:", HungerGamesBegin);

        const timerPassed = await getAsync("hasTimerPassed");
        console.log("timerPassed:", timerPassed);

        const currentTime = Math.floor(Date.now() / 1000);
        console.log("currentTime:", currentTime);

        const startTimer = await getAsync("time");
        console.log("startTimer:", startTimer);

        let intervalTime = await getAsync("roundDuration");
        console.log("intervalTime:", intervalTime);

        let notificationMessage;

        const roundsCount = await getAsync("roundsCount");
        console.log("roundsCount:", roundsCount);

        const startTimerNum = parseInt(startTimer) || 0;
        console.log("Converted startTimer:", startTimerNum);

        let intervalTimeNum = parseInt(intervalTime) || 0;
        console.log("Converted intervalTime:", intervalTimeNum);

        if (newGame === 'true') {
            intervalTimeNum = intervalTimeNum * 6;
            notificationMessage = `🚀 New Hunger Games will begin in `;
            console.log("Setting interval for new game:", intervalTimeNum);
        } else if (newGame === 'false' && HungerGamesBegin === 'true') {
            notificationMessage = `⏱️ The next round will begin in `;
            console.log("Setting interval for next round:", intervalTime);
        }
        console.log("Converted new intervalTime:", intervalTimeNum);
        const remainingTime = startTimerNum + intervalTimeNum - currentTime;
        console.log("remainingTime:", remainingTime);

        const minutes = Math.floor(remainingTime / 60);
        const seconds = remainingTime % 60;
        console.log("Computed minutes and seconds:", minutes, seconds);

        if (timerPassed === 'true') {
            bot.sendMessage(chatId, `🚀The timer has passed! The Hunger Games or round has begun or will begin shortly!`);
        } else if (remainingTime > 0) {
            bot.sendMessage(chatId, notificationMessage + `${minutes}:${seconds.toString().padStart(2, '0')} minutes!`);
        } else {
            bot.sendMessage(chatId, `🚀The Hunger Games or round has begun!`);
        }

        if (newGame === 'true') {
            bot.sendMessage(chatId, `Currently, in round 0.`);
        } else {
            const roundsCountNum = parseInt(roundsCount) || 0;
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
    const mintAmount = await NFTContract.getMintAmount();
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const safeUsername = username.replace(/_/g, '\\_');
    if (userTimestamps[userId] && (currentTime - userTimestamps[userId] < RATE_LIMIT)) {
        bot.sendMessage(msg.chat.id, `${safeUsername} Please wait for 10 seconds before using a command again. Alternatively, you can use /stats with up to 10 IDs at once (e.g., /stats ID1, ID2, ...).`, { parse_mode: 'Markdown' });
        return;
    }
    userTimestamps[userId] = currentTime;

    const chatId = msg.chat.id;
    let nftIds = match[1].split(',').map(id => Number(id.trim()));


    if (nftIds.length > 10) {
        nftIds = nftIds.slice(0, 10);  
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








