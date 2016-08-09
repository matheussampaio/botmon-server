process.env.TZ = 'utc';

const path = require('path');

const exec = require('child_process').exec;
const gcloud = require('gcloud')({
  projectId: 'pokemogo-1',

  // The path to your key file:
  keyFilename: path.join(__dirname, '../configs/pokemogo-1-7309e1a26e69.json')
});

const gce = gcloud.compute();
const zone = gce.zone('us-east1-b');

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

        console.log(`no VM starting, let's creating one...`);

        const name = o.key.slice(1).toLowerCase();
        const vm = zone.vm(name);
        const config = {
          machineType: 'f1-micro',
          metadata: {
            kind: 'compute#metadata',
            items: [
              {
                key: 'vmid',
                value: name
              },
              {
                key: 'startup-script',
                value: [
                  `#! /bin/bash`,
                  `set -e`,
                  `set -x`,
                  `sudo apt-get update`,
                  `sudo apt-get install -y build-essential python python-dev wget`,
                  `wget https://bootstrap.pypa.io/get-pip.py`,
                  `#sudo mkdir -p /mnt/disks/files/`,
                  `#sudo mount -o discard,defaults /dev/disk/by-id/google-instance-1-part1 /mnt/disks/files/`,
                  `#sudo chmod a+w /mnt/disks/files`,
                  `sudo python get-pip.py`,
                  `sudo pip install virtualenv requests`,
                  `curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -\nsudo apt-get install -y nodejs`,
                  `git clone https://8dbc541f364ffed0b61568cc1e7c01624cb58760@github.com/matheussampaio/botmon-vm.git`,
                  `git clone https://8dbc541f364ffed0b61568cc1e7c01624cb58760@github.com/matheussampaio/botmon-bot.git`,
                  `cd botmon-vm`,
                  `sudo npm install`,
                  `sudo node src/index.js > allout.txt 2>&1`
                ].join('\n\n')
              }
            ]
          },
          tags: {
            items: [
              'http-server',
              'https-server'
            ]
          },
            "disks": [
            {
              "type": "PERSISTENT",
              "boot": true,
              "mode": "READ_WRITE",
              "autoDelete": true,
              "deviceName": name,
              "initializeParams": {
                "sourceImage": "https://www.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/ubuntu-1604-xenial-v20160721",
                "diskType": "projects/pokemogo-1/zones/us-east1-b/diskTypes/pd-standard",
                "diskSizeGb": "10"
              }
            }
          ],
          "canIpForward": false,
          "networkInterfaces": [
            {
              "network": "projects/pokemogo-1/global/networks/default",
              "accessConfigs": [
                {
                  "name": "External NAT",
                  "type": "ONE_TO_ONE_NAT"
                }
              ]
            }
          ],
          "description": "",
          "scheduling": {
            "preemptible": false,
            "onHostMaintenance": "MIGRATE",
            "automaticRestart": true
          },
          "serviceAccounts": [
            {
              "email": "botmon@pokemogo-1.iam.gserviceaccount.com",
              "scopes": [
                "https://www.googleapis.com/auth/cloud-platform"
              ]
            }
          ]
        };

        vm.create(config, (err, vm, operation, apiResponse) => {
          console.log(err, vm, operation, apiResponse);
        });

      } else {
        console.log('we already have a VM starting');
      }

      vmsRef.orderByChild('status').equalTo('online').once('child_changed', resolve);
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

        if (time - vm.timestamp > 60 * 1000 && vm.status === 'starting') {
          console.log(`timeout on vm ${key}, removing it...`);
          vmsRef.child(key).remove();
        } else if (!vm.bots) {
          if (vm.idle) {
            if (time - vm.idle > 5 * 60 * 1000 && vm.status === 'online') {
              console.log('shutdown idle vm:', key);
              vmsRef.child(key).update({ status: 'shut_down' });

              vmsRef.orderByChild('status').equalTo('offline').once('child_changed', () => {
                const name = key.slice(1).toLowerCase();
                const vm = zone.vm(name);
                console.log('deleting instance', name);

                vm.delete(function(err, operation, apiResponse) {
                  // `operation` is an Operation object that can be used to check the status
                  // of the request.
                });
              });
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
