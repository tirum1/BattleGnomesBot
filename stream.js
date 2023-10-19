const { exec } = require('child_process');
require('dotenv').config();

function livestreamToTwitch() {
    console.log("Starting the livestreamToTwitch function...");

    const cmd = `ffmpeg -stream_loop -1 -i ./src/GnomeMP4.mp4 -stream_loop -1 -i ./src/song.wav -c:v copy -c:a aac -shortest -f flv ${process.env.TWITCH_STREAM_URL}`;
    console.log(`Executing command: ${cmd}`);

    const child = exec(cmd);

    child.stdout.on('data', (data) => {
        console.log(`[FFMPEG STDOUT]: ${data}`);
    });

    child.stderr.on('data', (data) => {
        console.error(`[FFMPEG STDERR]: ${data}`);
    });

    child.on('error', (error) => {
        console.error(`Child process error: ${error}`);
    });

    child.on('close', (code) => {
        console.log(`Child process exited with code ${code}`);
    });
}

console.log("Starting the script...");
livestreamToTwitch();
console.log("Finished initializing the livestream function (it will run in the background).");
