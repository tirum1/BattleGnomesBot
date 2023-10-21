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


const client = new Redis({
  host: process.env.REDIS_HOST, 
  port: process.env.REDIS_PORT, 
  password: process.env.REDIS_PASSWORD, 
});

bluebird.promisifyAll(client);
const getAsync = bluebird.promisify(client.get).bind(client);


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
            const hungerGamesMessage = `🚀 HungerGames have started!`;
            sendMessageViaAxios(CHANNEL_ID, hungerGamesMessage);
            
        } else if (timerPassed && counter >= 2) {

            await triggerFunction('lookForOpponent');
            console.log('Round Started!');

            const nonDead = await contract.getAliveCount();
            console.log(nonDead);
            const maxAmountOfWinner = await contract.maxAmountOfWinners();
            console.log(maxAmountOfWinner);
            const aliveCount = await getAliveCount(); 
            console.log(aliveCount);

            let roundMessage = "";

            if (aliveCount <= maxAmountOfWinner) {
                const roundWinnerLength = await contract.getRoundWinnersLength();
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