const { exec } = require('child_process');

function livestreamToTwitch() {
    const cmd = 'ffmpeg -stream_loop -1 -i ./src/GnomeMP4.mp4 -stream_loop -1 -i ./src/song.wav -c:v copy -c:a aac -shortest -f flv rtmp://live.twitch.tv/app/live_973039533_9BXRQV7EQVAoGo45Rg5KfDWtnd3ucj';

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
    });
}

livestreamToTwitch();
