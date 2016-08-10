const winston = require('winston');

const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      timestamp: () => {
        return new Date();
      },
      colorize: true,
    }),
    new (winston.transports.File)({
      filename: 'botmon.log',
      maxsize: 5 * 1000 * 1000, // 1 = Byte, 1000 Byte = 1 Kb, 1000Kb = 1Mb
      maxFiles: 10
    })
  ]
});

module.exports = logger;
