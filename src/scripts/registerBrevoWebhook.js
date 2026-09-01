require('dotenv').config();
require('module-alias/register');

const {
  createWebhook,
  getWebhooks,
  DEFAULT_TRANSACTIONAL_WEBHOOK_EVENTS,
} = require('@/service/mail/brevoService');

async function main() {
  const webhookUrl = process.argv[2] || process.env.BREVO_WEBHOOK_URL;

  if (!webhookUrl) {
    console.error('Usage: node src/scripts/registerBrevoWebhook.js <PUBLIC_WEBHOOK_URL>');
    console.error('Example: node src/scripts/registerBrevoWebhook.js https://my-domain.com/api/email/webhook');
    process.exit(1);
  }

  console.log(`Checking existing Brevo webhooks...`);
  try {
    const existing = await getWebhooks('transactional');
    console.log(`Found ${existing.webhooks.length} active webhooks in Brevo:`);
    existing.webhooks.forEach((w) => {
      console.log(` - ID: ${w.id} | URL: ${w.url} | Events: ${w.events.join(', ')}`);
    });
  } catch (e) {
    console.warn(`Could not list webhooks: ${e.message}`);
  }

  console.log(`\nRegistering webhook URL: ${webhookUrl}...`);

  try {
    const result = await createWebhook({
      url: webhookUrl,
      description: 'Brevo transactional email webhook endpoint for PEM backend',
      type: 'transactional',
      events: DEFAULT_TRANSACTIONAL_WEBHOOK_EVENTS,
    });

    console.log('\nSuccess! Webhook registered with Brevo.');
    console.log(`Webhook ID: ${result.id}`);
    console.log(`Target URL: ${webhookUrl}`);
  } catch (error) {
    console.error('\nFailed to register webhook with Brevo:');
    console.error(error.message);
    process.exit(1);
  }
}

main();
