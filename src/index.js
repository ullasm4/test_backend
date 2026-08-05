require('module-alias/register');
require('@/config/env');

const app = require('@/app');
const env = require('@/config/env');

app.listen(env.SERVER_PORT, '0.0.0.0', () => {
  console.log(`API listening on http://0.0.0.0:${env.SERVER_PORT}`);
});
