require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const axios = require('axios');
const Redis = require('ioredis'); 
const bluebird = require('bluebird');
const INFURA_ENDPOINT = process.env.INFURA_ENDPOINT;  
const provider = new ethers.providers.JsonRpcProvider(INFURA_ENDPOINT);
const CONTRACT_ADDRESS = '0x4FF4dd60888F9D640b49ec71662Ca9C000E76124';  
const ABI_PATH = './ABI/BattleContract.json'; 
const contractData = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
const ABI = contractData.abi;
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
const PRIVATE_KEY = process.env.MYMAINTENANCE;  
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const token = process.env.MAIN_BOT_TOKEN;
const TELEGRAM_BASE_URL = `https://api.telegram.org/bot${token}/`;
const CHANNEL_ID = '-1001672659906';
let isProcessing = false;

const client = new Redis({
  host: process.env.REDIS_HOST, 
  port: process.env.REDIS_PORT, 
  password: process.env.REDIS_PASSWORD, 
});

bluebird.promisifyAll(client);
const getAsync = bluebird.promisify(client.get).bind(client);


setInterval(async () => {
    if (isProcessing) {
        console.log('Still processing the last iteration. Skipping this interval.');
        return;
    }
    try {
        if (shouldTellJokeOrQuote()) {
            const randomMessage = getRandomMessage();
            sendMessageViaAxios(CHANNEL_ID, randomMessage);
        }
        isProcessing = true;
        console.log('Polling started...');

        const timerPassed = await hasTimerPassed();
        console.log('Timer passed:', timerPassed);

        const newGame = await isNewGame();
        console.log('Is new game:', newGame);

        const counter = await queuecounter();
        console.log('Queue counter:', counter);

        if (newGame && timerPassed) {

            await triggerFunction('startHungerGames');  
            console.log('HungerGames Started');
            const hungerGamesMessage = `🚀 HungerGames have started!`;
            sendMessageViaAxios(CHANNEL_ID, hungerGamesMessage);
            
        } else if (timerPassed && counter >= 2) {

            await triggerFunction('lookForOpponent');
            console.log('Round Started!');
            const maxAmountOfWinner = await contract.maxAmountOfWinners();
            console.log(maxAmountOfWinner);
            const aliveCount = await getAliveCount(); 
            console.log(aliveCount);

            let roundMessage = "";

            if (aliveCount <= maxAmountOfWinner) {
                const roundWinnerLength = await contract.getRoundWinnersLength();
                const aliveById = await contract.getAliveByID();
                let roundWinners;

                roundMessage = `⚔️ THE GAME HAS ENDED AND WE HAVE ${aliveCount} SURVIVORS ${aliveById}`;
                for (let i = 0; i < aliveCount; i++) {
                    roundMessage += shortenWallet(roundWinners[roundWinnerLength - i]);
                }
            } else {
                roundMessage = `⚔️ A new round has started! There are ${aliveCount} participants left alive.`;
            }
            
            sendMessageViaAxios(CHANNEL_ID, roundMessage);
        }
         else {
            console.log('No conditions met for triggering functions.');
        }

    } catch (error) {
        console.error('Error in polling mechanism:', error);
    } finally {
        isProcessing = false;
    }
}, 10000);

async function sendMessageViaAxios(chatId, text) {
    try {
        const response = await axios.post(TELEGRAM_BASE_URL + 'sendMessage', {
            chat_id: chatId,
            text: text
        });
        console.log(response.data);
    } catch (error) {
        console.error(`Error sending message: ${error.message}`);
    }
}
async function hasTimerPassed() {
    return await contract.hasTimerPassed();
}
async function isNewGame() {
    return await contract.newGame();
}
async function triggerFunction(functionName) {
    const contractWithSigner = contract.connect(wallet);

    try {
        const estimatedGas = await contractWithSigner.estimateGas[functionName]();
        const gasWithBuffer = estimatedGas.mul(ethers.BigNumber.from("120")).div(ethers.BigNumber.from("100"));

        let tx = await contractWithSigner[functionName]({ gasLimit: gasWithBuffer });
        let receipt = await tx.wait();
        console.log(`Successfully called ${functionName}! Transaction hash: ${receipt.transactionHash}`);
    } catch (error) {
        console.error('Error:', error);
    }
}
async function queuecounter() {
    try {
        const counter = await contract.queuecounter();
        return counter.toNumber(); 
    } catch (error) {
        console.error('Error in queuecounter:', error);
        return 0; 
    }
}
async function shortenWallet(longWallet) {
    if (longWallet.length < 11) {
        return longWallet;
    }
    return longWallet.slice(0, 6) + '...' + longWallet.slice(-4);
}
async function getAliveCount() {
    try {
        const aliveNFTs = await contract.getAliveByID();
        return aliveNFTs.length;
    } catch (error) {
        console.error('Error in getAliveCount:', error);
        return 0;  
    }
}
function shouldTellJokeOrQuote() {
    return Math.random() < 0.25;  // 25% chance
}
function getRandomMessage() {
    if (Math.random() < 0.5) {
        return getRandomJoke();
    } else {
        return getMysticQuote();
    }
}
function getMysticQuote() {
    return mysticQuotes[Math.floor(Math.random() * mysticQuotes.length)];
}
function getRandomJoke() {
    return jokes[Math.floor(Math.random() * jokes.length)];
}
const jokes = [
    "Why did the scarecrow win an award? 🌾 Because he was outstanding in his field!",
    "Why don't scientists trust atoms? ⚛️ Because they make up everything.",
    "How does a penguin build its house? 🐧 Igloos it together.",
    "Why did the golfer bring two pairs of pants? ⛳ In case he got a hole in one.",
    "What do you call fake spaghetti? 🍝 An impasta!",
    "Did you hear about the kidnapping at the playground? 🎠 They woke up.",
    "I told my wife she should embrace her mistakes. 🤗 She gave me a hug.",
    "Why don't skeletons fight each other? 💀 They don't have the guts.",
    "How do you organize a space party? 🌌 You planet.",
    "What do you call a parade of rabbits hopping backward? 🐇 A receding hare-line.",
    "Why did the gnome bring a ladder to the battle? 🍄 To get a height advantage!",
    "How do gnomes prepare for a battle royale? 🎮 They have a gnome tutorial.",
    "What's a gnome's favorite battle strategy? 🎩 High-hat and run!",
    "Why did the gnome refuse to participate in the royale? 🍂 He didn't gnome the stakes.",
    "Why did the gnome warrior blush? 🌳 He saw the salad dressing for the royal feast.",
    "What's a gnome's favorite spot in the battle arena? 🌲 The mushroom patch, it's the spore of the moment!",
    "Why was the gnome calm during the battle royale? 🍄 Because he was a fungi!",
    "How do gnomes communicate in a battle? 🎤 Gnoming code."
];
const mysticQuotes = [
    "The winds of time whisper secrets to those who listen. 🍃🕰️",
    "In the shadow of the moon, destiny awaits. 🌒✨",
    "Beware the ides of March, for fate is not kind to the unwary. 🗓️🔮",
    "Within the embers of chaos, a new journey ignites. 🔥",
    "Seek not the future in the stars, but within the depths of your soul. ⭐🔍",
    "Under the veil of night, the universe reveals its ancient tales. 📜",
    "In the dance of shadows, mysteries are born. 💃🌚",
    "The cosmos hums a melody, only heard by those who seek. 🎵",
    "When the owl sings at twilight, wisdom emerges from darkness. 🦉🌆",
    "Heed the murmurs of the old trees, they've seen centuries unfold. 🌳",
    "Within every ending, the seed of a new beginning lies dormant. 🌱🔄",
    "In the symphony of the universe, each of us is but a single note. 🎶🪐",
    "In the heart of the arena, destiny and doom dance in harmony. 🌌🔮",
    "For every gnome that falls, a legend rises. 🍄⚔️",
    "The path to treasure is paved with danger, but glory awaits the brave. 💰🏹",
    "Under the crimson moon, warriors seek the ultimate prize. 🌕💎",
    "Amidst the clash of swords, the fates weave a tale of blood and gold. ⚔️💰",
    "Seek not just the treasure, but the journey that leads to it. 🌍🔍",
    "In the shadows of the arena, destiny whispers tales of triumph and tragedy. 🎭🌑",
    "To emerge victorious, one must embrace the dance of life and death. 💃💀",
    "The bravest are not those who enter, but those who emerge from the bloody arena. 🍄🔥",
    "Treasures are not merely gold and gems, but the memories forged in battle. ⚔️❤️",
    "In the heart of conflict, the true prize is not treasure, but the spirit of a warrior. 🍄"
];


  