const axios = require('axios');
const env = require('@/config/env');
const { toWhatsAppDestination } = require('./extractPhones');

function getConfig() {
  return {
    apiKey: env.WHATSAPP_SERVICE_API_KEY || '',
    apiUrl: env.WHATSAPP_API_URL || '',
    campaignName: env.WHATSAPP_CAMPAIGN_NAME || 'T1',
    source: env.WHATSAPP_SOURCE || 'contract-desk',
    mediaUrl: (env.WHATSAPP_MEDIA_URL || '').trim(),
    mediaFilename: env.WHATSAPP_MEDIA_FILENAME || 'sample_media',
  };
}

async function sendCampaignMessage(destinationInput, options = {}) {
  const config = getConfig();
  const destination = toWhatsAppDestination(destinationInput);
  const userName = String(options.userName || '').trim();

  if (!destination) {
    return { success: false, skipped: true, reason: 'invalid_destination' };
  }

  if (!userName) {
    return { success: false, skipped: true, reason: 'missing_user_name' };
  }

  if (!config.apiKey || !config.apiUrl) {
    return { success: false, skipped: true, reason: 'config' };
  }

  const campaignName = options.campaignName || config.campaignName;
  const source = options.source || config.source;
  const mediaUrl = (options.mediaUrl || config.mediaUrl || '').trim();
  const mediaFilename = options.mediaFilename || config.mediaFilename;

  const payload = {
    apiKey: config.apiKey,
    campaignName,
    destination,
    userName,
    templateParams: Array.isArray(options.templateParams) ? options.templateParams : [],
    source,
    media: mediaUrl ? { url: mediaUrl, filename: mediaFilename } : {},
    buttons: Array.isArray(options.buttons) ? options.buttons : [],
    carouselCards: Array.isArray(options.carouselCards) ? options.carouselCards : [],
    location: options.location && typeof options.location === 'object' ? options.location : {},
    attributes: options.attributes && typeof options.attributes === 'object' ? options.attributes : {},
    paramsFallbackValue:
      options.paramsFallbackValue && typeof options.paramsFallbackValue === 'object'
        ? options.paramsFallbackValue
        : {},
  };

  try {
    const response = await axios.post(config.apiUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true,
    });

    console.log('[WhatsApp] AiSensy response', {
      destination,
      userName,
      status: response.status,
      data: response.data,
    });

    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        destination,
        userName,
        campaignName,
        status: response.status,
        data: response.data ?? null,
      };
    }

    const message =
      (typeof response.data === 'object'
        && (response.data?.message || response.data?.error || response.data?.msg))
      || `AiSensy returned HTTP ${response.status}`;

    return {
      success: false,
      reason: 'api_error',
      destination,
      userName,
      status: response.status,
      message: String(message),
      data: response.data ?? null,
    };
  } catch (error) {
    console.log('[WhatsApp] AiSensy request error', {
      destination,
      userName,
      message: error?.message,
    });
    return {
      success: false,
      reason: 'transport',
      destination,
      userName,
      message: error?.message || 'Failed to reach AiSensy API',
    };
  }
}

module.exports = {
  getConfig,
  sendCampaignMessage,
  toWhatsAppDestination,
};
