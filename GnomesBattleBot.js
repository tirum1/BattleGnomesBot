require('dotenv').config();
const fs = require('fs');
const { ethers} = require('ethers');
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.MAIN_BOT_TOKEN;
const redis = require('redis');
const bluebird = require('bluebird');
const bot = new TelegramBot(token, { polling: true });
const hungerGamesAddress = '0x3511910Cd2c60a77a7f095Ce3c5d8AE1fBf680cd';
const GnomesCollectiveAddress = "0x6742eE08d1ac25f72d741708E37AD69C9e7F4b22";
const redisUrl = process.env.MAIN_REDIS_URL;
const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
const tokenContractABI = JSON.parse(fs.readFileSync('./ABI/HungerGames.json', 'utf8')).abi;
const NFTContractABI = JSON.parse(fs.readFileSync('./ABI/GnomesCollective.json', 'utf8')).abi;
const tokenContract = new ethers.Contract(hungerGamesAddress, tokenContractABI, provider);
const NFTContract = new ethers.Contract(GnomesCollectiveAddress, NFTContractABI, provider);

const userTimestamps = {};
const RATE_LIMIT = 1 * 10 * 1000;

const client = redis.createClient({ 
    url: redisUrl,
    retry_strategy: function(options) {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('The server refused the connection');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
            return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
    }
});

bluebird.promisifyAll(client);

client.on('connect', () => {
    console.log('[PASS]'.green + ' Redis Connected');
});
client.on('error', (err) => {
    console.error('Redis error:', err);
});

const getAsync = bluebird.promisify(client.get).bind(client);

bot.onText(/\/?nft ([\d\s,]+)/i, async (msg, match) => {

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
            console.log("Debug1");
            const retrievedDead = await getAsync("dead"); 
            let isDead = false; 
            console.log("Debug2");
            if (retrievedDead) {
                const parsedDead = JSON.parse(retrievedDead);

                if (Array.isArray(parsedDead)) {
                    isDead = parsedDead.some(entry => Array.isArray(entry) && entry.length === 2 && entry[0] === nftId && entry[1] === true);
                }
            }
            console.log("Debug3");
            const keyName = `${nftId}BattleResult`; 
            const battleDetailData = await getAsync(keyName); 

            let battleDetail = null; 
            console.log("Debug4");
            if (battleDetailData) {
                battleDetail = JSON.parse(battleDetailData);
            }

            console.log("Debug5");
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

                message += `🏆 Result: ${battleDetail.result}\n`;

                message += `💥 Used XTRA: ${battleDetail.XTRA ? 'Yes' : 'No'}\n`;
                message += `⚡ Used BOOST: ${battleDetail.BOOST ? 'Yes' : 'No'}\n`;
                message += `✨ Used V: ${battleDetail.V ? 'Yes' : 'No'}\n`;
                message += `⏭️ Used SKIP: ${battleDetail.SKIP ? 'Yes' : 'No'}`;
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
        const deadData = await getAsync("dead");
        console.log("Fetched dead data:", deadData);

        const deadArray = deadData ? JSON.parse(deadData) : [];
        console.log("Parsed dead array:", deadArray);

        const liveNFTs = deadArray.filter(entry => entry[1] === false).map(entry => entry[0]);

        const liveNFTsData = await Promise.all(liveNFTs.map(async (nftID) => {
            const roundWinsKey = `roundWinsOf${nftID}`;
            const roundWinsStr = await getAsync(roundWinsKey) || "0"; 
            const roundWins = parseInt(roundWinsStr, 10); 
            return { nftID, roundWins };
        }));
               

        liveNFTsData.sort((a, b) => b.roundWins - a.roundWins);

        const top30 = liveNFTsData.slice(0, 30);

        console.log("Top 30 live NFTs with roundWins:", top30);

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

        const response = top30.map((data, index) => {
            const medal = medals[index] || '';
            return medal
                ? `${medal} ID: ${data.nftID}, Round Wins: ${data.roundWins}`
                : `${index + 1}. ID: ${data.nftID}, Round Wins: ${data.roundWins}`;
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
            intervalTimeNum = intervalTimeNum * 3;
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

bot.onText(/\/?stats ([\d\s,]+)/i, async (msg, match) => {
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

    try {
        const retrievedStats = await getAsync("stats");

        if (retrievedStats) {
            const allNFTStats = JSON.parse(retrievedStats);

            for (let nftId of nftIds) {
                if (nftId <= 0 || nftId > mintAmount) {
                    bot.sendMessage(chatId, `${safeUsername}, NFT with ID ${nftId} doesn't exist.`, { parse_mode: 'Markdown' });
                    continue;
                }

                const nftStats = allNFTStats[nftId];

                if (nftStats) {
                    const [hp, attack, defense, intellect, special] = nftStats;

                    const battleWins = await getAsync(`battleWinsOf${nftId}`);
                    const battleLosses = await getAsync(`battleLossOf${nftId}`);
                    const roundWins = await getAsync(`roundWinsOf${nftId}`);

                    const totalPotionsUsed = await tokenContract.potionsUsed(nftId);

                    let message = `${safeUsername}, 📊 *Fight Stats for NFT ${nftId}:*\n\n`;
                    message += `- HP: ${hp}\n`;
                    message += `- Attack: ${attack}\n`;
                    message += `- Defense: ${defense}\n`;
                    message += `- Intellect: ${intellect}\n`;
                    message += `- Special: ${special}\n\n`;

                    message += `🏆 *Battle Record for NFT ${nftId}:*\n\n`;
                    message += `- Wins: ${battleWins || 0}\n`;
                    message += `- Losses: ${battleLosses || 0}\n`;
                    message += `- Game Wins: ${roundWins || 0}\n\n`;

                    message += `🧪 *Potions Usage for NFT ${nftId}:*\n\n`;
                    message += `- Total Potions Used: ${totalPotionsUsed || 0}`;

                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, `${safeUsername}, Stats not found for NFT ${nftId}.`, { parse_mode: 'Markdown' });
                }
            }
        } else {
            bot.sendMessage(chatId, `${safeUsername}, No stats found in Redis.`, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        bot.sendMessage(chatId, `${safeUsername}, Error fetching stats for NFTs. Please try again later.`, { parse_mode: 'Markdown' });
        console.error(error);
    }
});









