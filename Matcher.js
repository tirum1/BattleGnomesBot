console.log("Starting the script...");

require('dotenv').config({ path: './.env' });
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require('ethers');
const bluebird = require('bluebird');
const redis = require('redis');
const axios = require('axios');
const FormData = require('form-data');

const redisUrl = process.env.MAIN_REDIS_URL;
const MYMaintenance = process.env.MYMAINTENANCE;
const hungerGamesAddress = '0x86B8837f50Cb1f6d07a0245fDC123A66CC50d581';
const battleGnomesAddress = '0xe306cB8DCeA669d9De206BE116468d5a8AbB6bDb';
const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
const MYMaintenanceWallet = new ethers.Wallet(MYMaintenance, provider);
const TokenABI = JSON.parse(fs.readFileSync('./ABI/HungerGames.json', 'utf8')).abi;
const NFTABI = JSON.parse(fs.readFileSync('./ABI/GnomesCollective.json', 'utf8')).abi;
const battleABI = JSON.parse(fs.readFileSync('./ABI/BattleContract.json', 'utf8')).abi;
const TokenContract = new ethers.Contract(hungerGamesAddress, TokenABI, provider);
const TokenContractWithSigner = TokenContract.connect(MYMaintenanceWallet);
const battleContract = new ethers.Contract(battleGnomesAddress, battleABI, provider);

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
const setAsync = bluebird.promisify(client.set).bind(client);
const delAsync = bluebird.promisify(client.del).bind(client);
