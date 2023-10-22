require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const axios = require('axios');
const Redis = require('ioredis'); 
const bluebird = require('bluebird');
const INFURA_ENDPOINT = process.env.INFURA_ENDPOINT;  
const provider = new ethers.providers.JsonRpcProvider(INFURA_ENDPOINT);
const CONTRACT_ADDRESS = '0x9e5439DbBDE0E76F050F356852501394DD940770';  
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
let txHashForWinnersFound; 
const client = new Redis({
  host: process.env.REDIS_HOST, 
  port: process.env.REDIS_PORT, 
  password: process.env.REDIS_PASSWORD, 
});

bluebird.promisifyAll(client);
const getAsync = bluebird.promisify(client.get).bind(client);


contract.on("WinnersFound", async () => {
    try {
        console.log("WinnersFound event detected!");
        const filter = contract.filters.WinnersFound();  
        const logs = await provider.getLogs({
            fromBlock: 'latest',
            toBlock: 'latest',
            address: contract.address,
            topics: filter.topics
        });
        txHashForWinnersFound = logs[0]?.transactionHash;
    } catch (error) {
        console.error('Error while handling WinnersFound event:', error);
    }
});

setInterval(async () => {
    if (isProcessing) {
        console.log('Still processing the last iteration. Skipping this interval.');
        return;
    }
    try {
        if (shouldTellSomething()) {
            const randomMessage = getRandomMessage();
            sendMessageViaAxios(CHANNEL_ID, randomMessage);
        }
        const currentTime = Math.floor(Date.now() / 1000);
        const startTimer = await contract._startTimer();
        const startTimerNum = startTimer.toNumber();
        let intervalTime = await contract.roundDuration();
        let intervalTimeNum = intervalTime.toNumber();
        if (await isNewGame()) {
            intervalTimeNum = intervalTimeNum * 6;
        }
        const remainingTime = startTimerNum + intervalTimeNum - currentTime;
        if (Math.random() < 0.1) { 
            const readyMessage = getReadyQuote(remainingTime);
            sendMessageViaAxios(CHANNEL_ID, readyMessage);
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
            sendMessageViaAxios(CHANNEL_ID, "🔮✨ HUNGERGAMES INITIATED: DAWN OF DESTINY ✨🔮");
            await triggerFunction('startHungerGames');  
            console.log('HungerGames Started');
            const hungerGamesMessage = `🚀 THE BATTLEGROUND AWAITS THE BRAVE!`;
            sendMessageViaAxios(CHANNEL_ID, hungerGamesMessage);
            
        } else if (timerPassed && counter >= 2) {
            sendMessageViaAxios(CHANNEL_ID, "🌙🔥 ROUND INITIATED: ECHOES OF VALOR 🔥🌙");
            await triggerFunction('lookForOpponent');
            console.log('Round Started!');
            const maxAmountOfWinnerBigNumber = await contract.maxAmountOfWinners();
            const maxAmountOfWinner = maxAmountOfWinnerBigNumber.toNumber();
            console.log("maxamountofwinners:", maxAmountOfWinner);
            const aliveCount = await contract.getAliveByID(); 
            console.log("aliveCountLength:", aliveCount.length);

            let roundMessage = "";

            if (aliveCount.length <= maxAmountOfWinner) {
                const roundWinnerLength = (await contract.getRoundWinnersLength()).toNumber();
                console.log("roundWinnerLength:", roundWinnerLength);
                const aliveById = (await contract.getAliveByID()).map(id => id.toNumber());
                console.log("aliveByID:", aliveById);
                
                roundMessage = `⚔️ THE GAME HAS ENDED AND WE HAVE ${aliveCount.length} SURVIVORS ${aliveById.join(', ')}; Transaction Hash: ${txHashForWinnersFound}`; 
                
                for (let i = 0; i < aliveCount.length; i++) {
                    const winnerAddress = await contract.roundWinners(roundWinnerLength - (i + 1));
                    roundMessage += shortenWallet(winnerAddress);
                }
            } else {
                roundMessage = `⚔️ A new round has started! There are ${aliveCount.length} participants left alive.`;
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
function shouldTellSomething() {
    return Math.random() < 0.1;  
}
function getRandomMessage() {
    const random = Math.random();
    if (random < 0.33) {
        return getRandomJoke();
    } else if (random >= 0.33 && random < 0.66) {
        return getMysticQuote();
    } else {
        return getRandomBullishQuotes();
    } 
}
function getMysticQuote() {
    return mysticQuotes[Math.floor(Math.random() * mysticQuotes.length)];
}
function getRandomJoke() {
    return jokes[Math.floor(Math.random() * jokes.length)];
}
function getRandomBullishQuotes() {
    return bullishQuotes[Math.floor(Math.random() * bullishQuotes.length)];
}
function getReadyQuote(remainingTime) {
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    const timeString = `${minutes} minutes and ${seconds} seconds`;

    const underOneMinuteQuotes = [
        `🔥 Just ${seconds} seconds! Gnomes, to your positions!`,
        `🌪️ A storm's brewing! ${seconds} seconds and it's unleashed!`,
        `🛡️ Gnomes, rally! Only ${seconds} ticks of the clock remain!`,
        `🍀 Luck be with you! Just ${seconds} seconds to fate's call!`,
        `📣 Hear the drums of war? Just ${seconds} seconds to the beatdown!`
    ];

    const underFiveMinutesQuotes = [
        `⏱️ ${timeString} until destiny awaits! Are you ready?`,
        `🌌 As stars align, ${timeString} and the saga unfolds.`,
        `🌟 Hold onto your dreams, gnomes. ${timeString} till they're tested!`,
        `⚡️ Energy surges as ${timeString} remain. Charge up, gnomes!`,
        `🔮 The crystal ball shows... ${timeString} to the showdown!`
    ];

    const underTenMinutesQuotes = [
        `🌈 A rainbow of possibilities in the next ${timeString}! Choose your path.`,
        `🏰 Fortify your defenses! ${timeString} to siege time!`,
        `🌲 Whispering woods say... ${timeString} to prove your might!`,
        `⛏️ Dig deep! Resources and time are limited. Only ${timeString} left.`,
        `🎭 Masks on! The grand theatre of battle begins in ${timeString}.`
    ];

    const generalQuotes = [
        `⏳ The sands of time flow, ${timeString} until they reveal all.`,
        `🌊 As waves crash, so does destiny in ${timeString}.`,
        `🍂 As leaves fall, so does time. ${timeString} to the next chapter.`,
        `🌔 By moon's phase, in ${timeString} a new battle dawns.`,
        `🌻 Sunflowers turn, time churns. ${timeString} to the next challenge.`
    ];

    if (remainingTime <= 60) {
        return underOneMinuteQuotes[Math.floor(Math.random() * underOneMinuteQuotes.length)];
    } else if (remainingTime <= 300) {
        return underFiveMinutesQuotes[Math.floor(Math.random() * underFiveMinutesQuotes.length)];
    } else if (remainingTime <= 600) {
        return underTenMinutesQuotes[Math.floor(Math.random() * underTenMinutesQuotes.length)];
    } else {
        return generalQuotes[Math.floor(Math.random() * generalQuotes.length)];
    }
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
    "How do gnomes communicate in a battle? 🎤 Gnoming code.","Why did the gnome get promoted? 🍄 Because he was a fungi to be with at work!",
    "Why did the gnome sit on the clock? 🕰️ He wanted to be on gnome time!",
    "What do you call a gnome's mobile home? 🚐 A gnome-mad.",
    "Why did the gnome keep his money in the blender? 🍹 He liked liquid assets!",
    "What did the gnome say to its therapist? 🛋️ I feel like people take me for granite.",
    "How do gnomes greet each other in a secret society? 🎩 Mystically, with a gnome-knack!",
    "Why did the gnome always win at cards? 🃏 He could read the crystal ball!",
    "How do gnomes like their battles? 🌲 Short and sweet!",
    "Why did the gnome get kicked out of the secret garden? 🌷 He was bad at keeping plant secrets!",
    "Why did the gnome go to school? 🍎 To improve his elf-esteem!",
    "Why did the mystical gnome avoid the pond? 🌌 He had a terrifying vision of a frog in his future!",
    "Why did the gnome dislike the wizard? 🧙‍♂️ He always looked down on him!",
    "How did the gnome predict the weather? 🌦️ With his gnome-ometer!",
    "What's a gnome's favorite instrument in a mystic band? 🎵 The magical lute!",
    "What do gnomes give their wives on Valentine's Day? 🌹 Rubies, because diamonds are too mainstream in the mystical world!",
    "What did the gnome say after a long day of battling? ⚔️ That gnome-tally wore me out!",
    "Why did the gnome make a good secret agent? 🕶️ Because he was good at staying low!",
    "Why did the gnome hate the giant's party? 🎉 Everyone talked over his head!",
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
const bullishQuotes = [
    "💎 HOLD STRONG, WE RISE!",
    "🚀 TO THE MOON AND BEYOND!",
    "🐂 BULLISH TERRITORY AHEAD!",
    "🛡️ FUCK THE BEARS, STAY STRONG!",
    "🔥 RAID TWITTER, SPREAD THE FIRE!",
    "🤝 BASED TEAM, STRONGER TOGETHER!",
    "💼 BASED DEV, ALWAYS DELIVERING!",
    "⚙️ WORKING UTILITY, THE FUTURE IS NOW!",
    "🌊 RIDE THE BULL WAVE!",
    "🔗 UNITY IS OUR STRENGTH, HOLD TOGETHER!",
    "📈 EVERY DIP IS AN OPPORTUNITY, BULLS TAKE CHARGE!",
    "🎯 FOCUS ON THE GOAL, LET'S WIN THIS!",
    "💪 COMMUNITY POWER, UNMATCHED!",
    "🦁 HEAR US ROAR, BEARS BEWARE!",
    "✨ BRIGHT FUTURE AWAITS, STAY BULLISH!",
    "📣 LET OUR VOICES BE HEARD, LOUD AND PROUD!",
    "💰 THIS IS JUST THE BEGINNING, TREASURES AHEAD!",
    "🌟 NEVER DOUBT OUR SHINE, ALWAYS BULLISH!",
    "🚂 FULL STEAM AHEAD! NO BRAKES ON THIS TRAIN!",
    "🐾 BEARS' STEPS ARE TEMPORARY, BULLS RUN THE SHOW!",
    "🏆 CHAMPIONS OF THE GAME, ALWAYS LEADING THE WAY!",
    "🎉 CELEBRATE EVERY VICTORY, BIG OR SMALL!",
    "🪙 TREASURE ISN'T ALWAYS GOLD, SOMETIMES IT'S DIAMOND HANDS!",
    "⭐ OUR STARS SHINE THE BRIGHTEST IN THE DARKEST NIGHTS!",
    "💡 BRILLIANT MINDS, BULLISH HEARTS!",
    "🌐 TOGETHER, WE'RE UNSTOPPABLE! GLOBAL DOMINATION!",
    "🌋 ERUPTING WITH POTENTIAL, WATCH US SOAR!",
    "🏰 OUR FORTRESS STANDS TALL, BEARS SHALL NOT PASS!",
    "🛡️ DEFENDERS OF THE BULLISH REALM, ONWARD!",
    "🚀 LAUNCHING INTO PROSPERITY, ONE MILESTONE AT A TIME!",
    "📯 SOUND THE HORNS, VICTORY AWAITS!",
    "🔊 BULLISH CHANTS ECHO IN OUR HALLS! LET THEM RING!",
    "🍀 FORTUNE FAVORS THE BOLD, AND WE'RE THE BOLDEST!",
    "🔥 IGNITE THE PASSION, BURN BRIGHTER THAN THE STARS!",
    "💣 BEARS, TICK TOCK! OUR TIME IS NOW!"
];


  