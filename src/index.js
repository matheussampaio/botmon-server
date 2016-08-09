const exec = require('child_process').exec;
// const gcloud = require('gcloud')({
//   projectId: 'pokemongo-1',
//
//   // The path to your key file:
//   keyFilename: './configs/pokemogo-1-7309e1a26e69.json'
// });

console.log('starting server instance...');

console.log('server folder:', __dirname)

const MAX_NUMBER_BOTS_PER_VM = 5;
const botWaitingAllocation = [];
let isAllocating = false;

// Firebase
const firebase = require('firebase');

console.log('initializing firebase app...');

firebase.initializeApp({
  serviceAccount: './configs/botmon-config.json',
  databaseURL: 'https://meowth-aed86.firebaseio.com'
});

const db = firebase.database();

const botsRef = db.ref('bots/');
const vmsRef = db.ref('vms/');

console.log('adding listerns for bots/status');

// When bots are added of modified, check if we should allocate them
botsRef.orderByChild('status').equalTo('waiting_allocation').on('child_added', snapshot => handleUpdate(snapshot.key, snapshot.val()));
botsRef.orderByChild('status').equalTo('waiting_allocation').on('child_changed', snapshot => handleUpdate(snapshot.key, snapshot.val()));

console.log('adding listenrs for vms');
// When a new VM is created, check is any bot is waiting for allocation
// vmsRef.once('child_added', handleVMUpdate);
// vmsRef.orderByChild('status').equalTo('online').on('child_changed', handleVMUpdate);

// Update VMs

updateVMs();

setInterval(updateVMs, 30000);

function handleUpdate(botKey, botValues) {
  console.log(`bot ${botKey} is waiting for allocation`, botValues);

  botValues['key'] = botKey;

  botWaitingAllocation.push(botValues);

  allocateBot();
}

function allocateBot() {
  if (!isAllocating && botWaitingAllocation.length) {
    isAllocating = true;

    const bot = botWaitingAllocation[0];
    console.log(`allocating bot ${bot.key}...`);

    getFreeVMKey()
      .then(key => {
        console.log(`allocating bot ${bot.key} to vm ${key}`);

        botWaitingAllocation.shift();

        return Promise.all([
          botsRef.child(bot.key).update({ vm: key, status: 'waiting_for_vm', timestamp: (new Date).getTime() }),
          vmsRef.child(`${key}/bots`).update({ [bot.key]: 1 }),
          vmsRef.child(`${key}`).update({ idle: 0 })
        ]);
      })
      .catch(() => {
        console.log(`no free VM, let's check if we should create one...`);
        return startNewVM();
      })
      .then(() => {
        isAllocating = false;
        allocateBot();
      });
  } else {
    console.log('another allocation going on');
  }
}

function handleVMUpdate() {
  console.log('new VM is online, check if we have bots waiting for allocation');

  botsRef.orderByChild('status').equalTo('waiting_allocation').once('value', snapshot => {
    const botsWaiting = snapshot.val();

    if (botsWaiting) {
      for (let key of Object.keys(botsWaiting)) {
        handleUpdate(key, botsWaiting[key]);
      }
    } else {
      console.log(`we don't have bots waiting for allocations`);
    }
  });
}

function startNewVM() {
  console.log('startNewVM');

  return new Promise((resolve, reject) => {
    vmsRef.orderByChild('status').equalTo('starting').once('value', snapshot => {
      const vmsStarting = snapshot.val();

      if (!vmsStarting) {
        const o = vmsRef.push({
          status: 'starting',
          timestamp: (new Date).getTime()
        });

        o.once('child_changed', resolve);

        console.log(`no VM starting, let's creating one...`);

        const child = exec(`CONFIG_VM_ID=${o.key} node ../vm/src/index.js`);

        child.stdout.on('data', (data) => {
          console.log(`VM [ ${o.key} ] stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
          console.log(`VM [ ${o.key} ] stderr: ${data}`);
        });

        child.on('close', (code) => {
          console.log(`VM [ ${o.key} ] child process exited with code ${code}`);
        });
      } else {
        console.log('we already have a VM starting');
      }
    });
  });

}

function getFreeVMKey() {
  console.log('checking for free vms...');

  return new Promise((resolve, reject) => {
    vmsRef.orderByChild('status').equalTo('online').once('value', snapshot => {
      const vms = snapshot.val();
      let best_vm = null;
      let best_vm_key = null;

      if (vms) {
        for (let key of Object.keys(vms)) {
          const vm = vms[key];

          if (!vm.bots) {
            vm.bots = {};
          }

          if (Object.keys(vm.bots).length < MAX_NUMBER_BOTS_PER_VM) {
            if (best_vm === null || Object.keys(vm.bots).length > Object.keys(best_vm.bots).length) {
              best_vm = vm;
              best_vm_key = key;
            }
          }
        }
      } else {
        console.log('no vm online, we should start a new one');
      }

      if (best_vm_key) {
        console.log('best free vm is', best_vm_key, best_vm);

        return resolve(best_vm_key);
      } else {
        return reject();
      }
    });
  });
}

function updateVMs() {
  console.log('checking for timeout vms...');

  vmsRef.once('value', snapshot => {
    const vms = snapshot.val();

    if (vms) {
      for (let key of Object.keys(vms)) {
        const vm = vms[key];
        const time = (new Date).getTime();

        if (time - vm.timestamp > 60000) {
          console.log(`timeout on vm ${key}, removing it...`);
          vmsRef.child(key).remove();
        } else if (!vm.bots) {
          if (vm.idle) {
            if (time - vm.idle > 120000 && vm.status === 'online') {
              console.log('shutdown idle vm:', key);
              vmsRef.child(key).update({ status: 'shut_down' });
            }
          } else {
            console.log(`marking vm ${key} as idle`);
            vmsRef.child(key).update({ idle: (new Date).getTime() });
          }
        };
      }
    } else {
      console.log(`we don't have any VMs`);
    }
  });
}
