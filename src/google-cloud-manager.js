const path = require('path');
const gcloud = require('gcloud')({
  projectId: 'pokemogo-1',
  keyFilename: path.join(__dirname, '../configs/pokemogo-1-7309e1a26e69.json')
});

const logger = require('./logger');

class GoogleCloudManager {
  constructor() {
    this.gce = gcloud.compute();
    this.zone = this.gce.zone('us-east1-b');
  }

  // TODO: check if this name is taken
  createVM(name) {
    const parsedName = this._parseName(name);

    if (parsedName) {
      const config = this._getConfig(parsedName);

      this.zone.vm(parsedName).create(config, (err, vm, operation, apiResponse) => {
        if (err) {
          return logger.error('error while creating the vm', err);
        }

        return logger.info(`vm ${parsedName} created`);
      });
    }
  }

  // TODO: check if this VM exists
  deleteVM(name) {
    const parsedName = this._parseName(name);

    if (parsedName) {
      this.zone.vm(parsedName).delete((err, operation, apiResponse) => {
        if (err) {
          return logger.error('error while deleting the vm', err);
        }

        return logger.info(`deleting VM ${parsedName}...`);
      });
    }

  }

  _getConfig(name) {
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
      disks: [
        {
          type: 'PERSISTENT',
          boot: true,
          mode: 'READ_WRITE',
          autoDelete: true,
          deviceName: name,
          initializeParams: {
            sourceImage: 'https://www.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/ubuntu-1604-xenial-v20160721',
            diskType: 'projects/pokemogo-1/zones/us-east1-b/diskTypes/pd-standard',
            diskSizeGb: '10'
          }
        }
      ],
      canIpForward: false,
      networkInterfaces: [
        {
          network: 'projects/pokemogo-1/global/networks/default',
          accessConfigs: [
            {
              name: 'External NAT',
              type: 'ONE_TO_ONE_NAT'
            }
          ]
        }
      ],
      description: '',
      scheduling: {
        preemptible: false,
        onHostMaintenance: 'MIGRATE',
        automaticRestart: true
      },
      serviceAccounts: [
        {
          email: 'botmon@pokemogo-1.iam.gserviceaccount.com',
          scopes: [
            'https://www.googleapis.com/auth/cloud-platform'
          ]
        }
      ]
    }

    return config;
  }

  _parseName(name) {
    return name.slice(1).toLowerCase();
  }
}

module.exports = GoogleCloudManager;
