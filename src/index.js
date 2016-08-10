process.env.TZ = 'utc';

const logger = require('./logger');
const Botmon = require('./botmon');

main();

function main() {
  logger.info('starting server instance...');
  logger.info('server folder:', __dirname)

  const botmon = new Botmon();

  botmon.init();

  setInterval(() => botmon.heartbeat(), 5000);
}
