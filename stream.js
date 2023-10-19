const { exec } = require('child_process');

function livestreamToTwitch() {
    const cmd = 'ffmpeg -stream_loop -1 -i ./src/GnomeMP4.mp4 -stream_loop -1 -i ./src/song.wav -c:v copy -c:a aac -shortest -f flv rtmp://live.twitch.tv/app/live_973039533_9BXRQV7EQVAoGo45Rg5KfDWtnd3ucj';

    const child = exec(cmd);

    child.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    child.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    child.on('error', (error) => {
        console.error(`exec error: ${error}`);
    });

    child.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });
}

livestreamToTwitch();
