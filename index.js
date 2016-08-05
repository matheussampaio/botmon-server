// Express
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Hello Meowth!');
});

app.listen(3000, () => {
  console.log('Meowth on 3000!');
});

// Firebase
const firebase = require('firebase');

firebase.initializeApp({
  serviceAccount: './meowth-config.json',
  databaseURL: 'https://meowth-aed86.firebaseio.com'
});

const db = firebase.database();

const ref = db.ref('bots/');

ref.on('child_added', snapshot => handleUpdate(snapshot.val()));
ref.on('child_changed', snapshot => handleUpdate(snapshot.val()));

ref.on('child_removed', (snapshot, key) => {
  console.log('removed', key, snapshot.val());
});

function handleUpdate(bot) {
  if (bot.next === 'create') {
    createBot(bot)
  } else if (bot.next === 'start') {
    startBot(bot)
  }
}

// ================
// Bot interaction
// ================

// create bot
function createBot(bot) {
    console.log('creating bot...')
    console.log(bot)
}

// start bot
function startBot(bot) {
    console.log('starting bot...')
    console.log(bot)
}
