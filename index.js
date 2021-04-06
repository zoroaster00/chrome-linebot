const express = require('express');
const crypto = require('crypto');
const rp = require('request-promise');
const app = express();
const env = require('./enviornment');
const fs = require('fs');
const readline = require('readline');

const port = 3000;
const TOKEN_FILE = './token.txt';
// prevent no duplicate token-id pair by using two maps
// token -> userId
const tokenUserTable = {};
// userId -> token
const reverseTable = {};
// write to file
loadTableFromFile(TOKEN_FILE);

function loadTableFromFile(path) {
    fs.access(path, fs.F_OK, (err) => {
        if (err) {
            console.error(err);
            fs.writeFile(path, '', err => err);
            return;
        }
        // load from existing file
        const file = readline.createInterface({
            input: fs.createReadStream(path),
            output: process.stdout,
            terminal: false
        });
        file.on('line', (line) => {
            const data = line.split(',');
            addEntry(data[0], data[1]);
        });
    })
}

function getSettingPOST(messageType, body) {
    return {
        method: 'POST',
        uri: `https://api.line.me/v2/bot/message/${messageType}`,
        headers: {
            "Content-type": "application/json; charset=UTF-8",
            "Authorization": " Bearer " + env.CHANNEL_TOKEN
        },
        json: true,
        body: body
    };
}

function generateFourDigitToken() {
    return 't' + Math.floor(Math.random() * 10000);
}

function replyToken(token, replyToken) {
    return rp(getSettingPOST('reply', {
            replyToken: replyToken,
            messages: [{
                type: 'text',
                text: token
            }]
        }))
        .then(function(response) {
            // console.log("Success : " + response);
        }).catch(function(err) {
            // console.log("Error : " + err);
        });
}

function pushToken(token, message) {
    const user = tokenUserTable[token];
    // console.log(`USER ${user}`);
    if (!user) {
        return Promise.resolve({ error: 'USER_NOT_FOUND' });
    }
    return rp(getSettingPOST('push', {
            to: user,
            messages: [{
                type: 'text',
                text: message
            }]
        }))
        .then(function(response) {
            // console.log("Success : " + response);
            return { success: true };
        }).catch(function(err) {
            // console.log("Error : " + err);
            return { error: err };
        });
}

function addEntry(token, userId, writeFile = false) {
    tokenUserTable[token] = userId;
    reverseTable[userId] = token;
    if (!writeFile) {
        return;
    }
    fs.appendFile(TOKEN_FILE, `${token},${userId}\n,`, err => {
        if (err) {
            console.error(err)
            return
        }
        //done!
    });
}

app.use(express.json()) // for parsing application/json
app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

app.use((req, res) => {
    // check signature of LINE API
    const text = JSON.stringify(req.body);
    const signature = crypto.createHmac('SHA256', env.CHANNEL_SECRET).update(text).digest('base64').toString();

    // validation
    if (signature !== req.headers['x-line-signature'] && !req.headers['t-token']) {
        return res.status(401).send('Unauthorized');
    }
    const ttoken = req.headers['t-token'];
    if (ttoken) {
        // console.log(`-- PUSH ${ttoken} ${req.body.message}`)
        pushToken(ttoken, req.body.message).then((result) => { res.status(200).send(result); });
        return;
    }
    const replyPromises = [];
    if (req.body && req.body.events) {
        for (let event of req.body.events) {
            const message = event.message;
            const source = event.source;
            if (message && message.type === 'text' && message.text === 'token' && source && source.userId) {
                if (reverseTable[source.userId]) {
                    // use existing token
                    replyPromises.push(replyToken(reverseTable[source.userId], event.replyToken));
                } else {
                    // not found, create token
                    const userToken = generateFourDigitToken();
                    addEntry(userToken, source.userId, true);
                    replyPromises.push(replyToken(userToken, event.replyToken));
                }
            }
        }
    }
    Promise.all(replyPromises).then(() => { res.status(200).send({}); });
});

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});