const _ = require('lodash');
const firebase = require('firebase');

const logger = require('./logger');
const GoogleCloudManager = require('./google-cloud-manager');

class Botmon {
  constructor() {
    this.MAX_NUMBER_BOTS_PER_VM = 5;
    this.botsWaitingAllocation = [];
    this.isAllocating = false;
    this.googleCloudManager = new GoogleCloudManager();
  }

  init() {
    logger.info('initializing firebase app...');

    firebase.initializeApp({
      serviceAccount: './configs/botmon-config.json',
      databaseURL: 'https://meowth-aed86.firebaseio.com'
    });

    const db = firebase.database();

    this.botsRef = db.ref('bots/');
    this.vmsRef = db.ref('vms/');
    this.botmonRef = db.ref('botmon/');

    // When bots are added of modified, check if we should allocate them
    logger.info('adding listerns for bots/status');

    this.botsRef.orderByChild('status')
      .equalTo('waiting_allocation')
      .on('child_added', snapshot => this.handleUpdate(snapshot.key, snapshot.val()));

    this.botsRef.orderByChild('status')
      .equalTo('waiting_allocation')
      .on('child_changed', snapshot => this.handleUpdate(snapshot.key, snapshot.val()));

    this.vmsRef.orderByChild('status')
      .equalTo('starting')
      .on('child_changed', snapshot => this.handleVMUpdate(snapshot.key, snapshot.val()));
  }

   handleUpdate(botKey, botValues) {
    if (_.find(this.botsWaitingAllocation, { key: botKey })) {
      return logger.info(`bot ${botKey} is ALREADY on the allocation queue`, botValues);
    }

    logger.info(`adding bot ${botKey} to the allocation queue`, botValues);

    botValues['key'] = botKey;

    this.botsWaitingAllocation.push(botValues);

    this.allocateBot();
  }

  allocateBot() {
    if (!this.isAllocating && this.botsWaitingAllocation.length > 0) {
      this.isAllocating = true;

      const bot = this.botsWaitingAllocation[0];

      logger.info(`trying to allocate bot ${bot.key}...`);

      this.getFreeVMKey()
        .then(key => {
          logger.info(`allocating bot ${bot.key} to vm ${key}`);

          // because we could get a good vm for this bot, we remove it from the list
          this.botsWaitingAllocation.shift();

          const updateBotWithWaitingForVMPromise = this.botsRef.child(bot.key)
            .update({
              vm: key,
              status: 'waiting_for_vm',
              timestamp: new Date().getTime()
            });

          const addBotsKeytoVMListPromise = this.vmsRef.child(`${key}/bots`)
            .update({
              [bot.key]: 1
            });

          const updateVMToBusyPromise = this.vmsRef.child(`${key}`)
            .update({
              idle: 0
            });

          return Promise.all([
            updateBotWithWaitingForVMPromise,
            addBotsKeytoVMListPromise,
            updateVMToBusyPromise
          ]);
        })
        .catch(() => {
          return this.startNewVM();
        })
        .then(() => {
          this.isAllocating = false;

          if (this.botsWaitingAllocation.length > 0) {
            this.allocateBot();
          }
        });
    } else {
      logger.info('another allocation going on');
    }
  }

  getFreeVMKey() {
    logger.info('checking for free vms...');

    return new Promise((resolve, reject) => {
      this.vmsRef.orderByChild('status')
        .equalTo('online')
        .once('value', snapshot => {
          const vms = snapshot.val();
          let best_vm = null;
          let best_vm_key = null;

          if (!vms) {
            logger.info('no vm online');
            return reject();
          }

          for (let key of Object.keys(vms)) {
            const vm = vms[key];

            if (!vm.bots) {
              vm.bots = {};
            }

            if (Object.keys(vm.bots).length < this.MAX_NUMBER_BOTS_PER_VM) {
              if (best_vm === null || Object.keys(vm.bots).length > Object.keys(best_vm.bots).length) {
                best_vm = vm;
                best_vm_key = key;
              }
            }
          }

          if (!best_vm_key) {
            logger.info('can\'t find a good vm');
            return reject();
          }

          logger.info('best free vm is', best_vm_key, best_vm);
          return resolve(best_vm_key);
        });
    });
  }

  startNewVM() {
    logger.info('trying to start a new vm...');

    return new Promise((resolve, reject) => {
      this.vmsRef.orderByChild('status')
        .equalTo('starting')
        .once('value', snapshot => {
          const vmsStarting = snapshot.val();

          if (vmsStarting) {
            logger.info('we already have a vm starting');
            return reject();
          }

          const newVM = this.vmsRef.push({
            status: 'starting',
            timestamp: new Date().getTime()
          });

          logger.info(`starting vm ${newVM.key}...`);

          this.googleCloudManager.createVM(newVM.key);

          this.vmsRef.orderByChild('status')
            .equalTo('online')
            .once('child_changed', resolve);
        });
    });
  }

  heartbeat() {
    this.botmonRef.update({
      status: 'online',
      timestamp: new Date().getTime()
    });

    this.vmsRef.once('value', snapshot => {
      const vms = snapshot.val();

      if (!vms) {
        return logger.info(`0 vms updated.`);;
      }

      let vmsUpdated = 0;

      for (let key of Object.keys(vms)) {
        const vm = vms[key];
        const time = new Date().getTime();

        // if we have an online VM that doesnt update timestamp for more than one minute
        // mark it as possible_offline
        if (vm.status === 'online' && time - vm.timestamp > 60 * 1000) {
          logger.info(`vm ${key} dosen't update for 1 minute, marking it as 'possible_offline'...`);

          // TODO: check if this VM has bots and move them for another VM.
          this.vmsRef.child(key)
            .update({
              status: 'possible_offline',
              timestamp: new Date().getTime()
            });

          vmsUpdated++;
        }

        // if VM is in `possible_offline` for more than 5 minutes, we should delete the VM
        // and remove the node
        if (vm.status === 'possible_offline' && time - vm.timestamp > 4 * 60 * 1000) {
          logger.info(`vm ${key} doesn't update for more than 5 minutes, deleting it...`);

          this.vmsRef.child(key)
            .remove()
            .then(() => {
              this.googleCloudManager.deleteVM(key);
            });

          vmsUpdated++;
        }

        // if VM is 'online' but is not running any bot, we should mark as idle
        if (vm.status === 'online' && !vm.bots && !vm.idle) {
          logger.info(`vm ${key} is idle`);

          this.vmsRef.child(key).update({
            idle: new Date().getTime()
          });

          vmsUpdated++;
        }

        // if VM is idle for more than 5 minutes, we should shut down
        if (vm.status === 'online' && vm.idle && time - vm.idle > 5 * 60 * 1000) {
          logger.info(`vm ${key} is 'idle' for more than 5 minutes, shuting down...`);

          this.vmsRef.child(key)
            .update({
              status: 'shut_down',
              timestamp: new Date().getTime()
            });

          vmsUpdated++;
        }

        // When VM is offline for more than 2 minutes, delete the node.
        if (vm.status === 'offline' && time - vm.timestamp > 1 * 60) {
          logger.info(`vm ${key} is 'offline' for more than 1 minute, deleting it...`);

          this.vmsRef.child(key).remove();
          this.googleCloudManager.deleteVM(key);

          vmsUpdated++;
        }
      }

      return logger.info(`${vmsUpdated} vms updated.`);;
    });
  }

  handleVMUpdate() {
    logger.info('new vm is online, check if we have bots waiting for allocation');

    this.botsRef.orderByChild('status')
      .equalTo('waiting_allocation')
      .once('value', snapshot => {
        const botsWaiting = snapshot.val();

        if (!botsWaiting) {
          return logger.info(`we don't have bots waiting for allocations`);
        }

        for (let key of Object.keys(botsWaiting)) {
          this.handleUpdate(key, botsWaiting[key]);
        }
      });
  }
}

module.exports = Botmon;
