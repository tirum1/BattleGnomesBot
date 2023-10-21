require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const Redis = require('ioredis'); 
const bluebird = require('bluebird');
const INFURA_ENDPOINT = process.env.INFURA_ENDPOINT;  
const provider = new ethers.providers.JsonRpcProvider(INFURA_ENDPOINT);
const CONTRACT_ADDRESS = '0x4FF4dd60888F9D640b49ec71662Ca9C000E76124';  
const ABI_PATH = './ABI/BattleContract.json'; 
const TelegramBot = require('node-telegram-bot-api');
const contractData = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
const ABI = contractData.abi;
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
const PRIVATE_KEY = process.env.MYMAINTENANCE;  
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const token = process.env.MAIN_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const CHANNEL_ID = -1672659906;


const client = new Redis({
  host: process.env.REDIS_HOST, 
  port: process.env.REDIS_PORT, 
  password: process.env.REDIS_PASSWORD, 
});

bluebird.promisifyAll(client);
const getAsync = bluebird.promisify(client.get).bind(client);

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

setInterval(async () => {
    try {
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
            const hungerGamesMessage = `🚀 HungerGames have started! There are ${counter} people queued up.`;
            bot.sendMessage(CHANNEL_ID, hungerGamesMessage);
            
        } else if (timerPassed && counter >= 2) {

            await triggerFunction('lookForOpponent');
            console.log('Round Started!');

            const nonDead = await contract.getAmountOfNonDead();
            const maxAmountOfWinner = await contract.maxAmountOfWinners();
            const aliveCount = await getAliveCount(); 

            let roundMessage = "";

            if (nonDead <= maxAmountOfWinner) {
                const aliveById = await contract.methods.getAliveByID().call();
                const roundWinners = await contract.methods.roundWinners().call();
            
                roundMessage = `⚔️ THE GAME HAS ENDED AND WE HAVE ${aliveCount} SURVIVORS ${aliveById}`;
                for (let i = roundWinners.length - 1; i >= 0; i--) {
                    roundMessage += shortenWallet(roundWinners[i]);
                }
            } else {
                roundMessage = `⚔️ A new round has started! There are ${aliveCount} participants left alive.`;
            }
            
            bot.sendMessage(CHANNEL_ID, roundMessage);
        }
         else {
            console.log('No conditions met for triggering functions.');
        }

    } catch (error) {
        console.error('Error in polling mechanism:', error);
    }
}, 10000);

