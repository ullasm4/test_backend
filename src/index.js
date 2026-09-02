require('module-alias/register');
require('@/config/env');

const app = require('@/app');
const env = require('@/config/env');
const { resumeIfRunning: resumeWhatsAppBulk } = require('@/service/whatsapp/bulkSender');
const { startNotificationCrons } = require('@/service/notifications');

app.listen(env.SERVER_PORT, '0.0.0.0', () => {
  console.log(`API listening on http://0.0.0.0:${env.SERVER_PORT}`);
  resumeWhatsAppBulk().catch((error) => {
    console.error('Failed to resume WhatsApp bulk job', error?.message);
  });
  startNotificationCrons();
});
