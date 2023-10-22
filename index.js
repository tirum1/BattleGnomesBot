require('./ColloseumBot.js');
require('./GnomesBattleBot.js');
// require('./triggerBot.js');  

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Our app is running on port ${PORT}`);
});
