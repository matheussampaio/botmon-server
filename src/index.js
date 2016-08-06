const gcloud = require('gcloud')({
  projectId: 'pokemongo-1',

  // The path to your key file:
  keyFilename: './configs/pokemogo-1-7309e1a26e69.json'
});

// Express
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Hello Botmon!');
});

app.listen(3000, () => {
  console.log('Botmon on 3000!');
});

// Firebase
const firebase = require('firebase');

firebase.initializeApp({
  serviceAccount: './configs/botmon-config.json',
  databaseURL: 'https://meowth-aed86.firebaseio.com'
});

const db = firebase.database();

const botsRef = db.ref('bots/');
const vmsRef = db.ref('vms/');

botsRef.on('child_added', snapshot => handleUpdate(snapshot.key, snapshot.val()));
botsRef.on('child_changed', snapshot => handleUpdate(snapshot.key, snapshot.val()));
botsRef.on('child_removed', (snapshot, key) => console.log('removed', key, snapshot.val()) );

function handleUpdate(botKey, botValues) {
  if (botValues.status === 'waiting_allocation') {
    botsRef.child(botKey).update({ vm: 'a1b2c3d4', status: 'waiting_for_vm' });
    vmsRef.child('a1b2c3d4/bots').update({ [botKey]: 1 });
  }
}
