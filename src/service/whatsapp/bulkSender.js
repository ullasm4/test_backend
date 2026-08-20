const { pool } = require('@/service/db');
const WhatsApp = require('@/service/whatsapp');

const SEND_INTERVAL_MS = 2_000;

let timer = null;
let tickInFlight = false;

async function queryOne(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

const JOB_COLUMNS = `
  wbj.id,
  wbj.status,
  wbj.daily_limit,
  wbj.sent_count,
  wbj.skipped_count,
  wbj.failed_count,
  wbj.processed_seller_ids,
  wbj.last_company_name,
  wbj.last_destination,
  wbj.last_error,
  wbj.started_by,
  u.name AS started_by_name,
  u.email AS started_by_email,
  wbj.started_at,
  wbj.stopped_at,
  wbj.completed_at,
  wbj.created_at,
  wbj.updated_at
`;

function asUuidArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return [];
}

function toUuidParam(value) {
  const ids = asUuidArray(value);
  return ids.length ? ids : null;
}

async function getTodaySendCount() {
  const row = await queryOne(`
    SELECT COUNT(*)::int AS sent_today
    FROM seller_whatsapp_log
    WHERE sent_at >= date_trunc('day', NOW())
      AND sent_at < date_trunc('day', NOW()) + INTERVAL '1 day'
  `);
  return row?.sent_today || 0;
}

async function getSellerCounts(excludeIds = []) {
  const excludeParam = toUuidParam(excludeIds);
  const [totalRow, sentRow, eligibleRow] = await Promise.all([
    queryOne(`
      SELECT COUNT(*)::int AS n
      FROM (
        SELECT x.seller_id
        FROM new_seller_information x
        WHERE public.seller_mobile_digits(x.phone) IS NOT NULL
        GROUP BY x.seller_id
      ) t
    `),
    queryOne(`SELECT COUNT(*)::int AS n FROM seller_whatsapp_log`),
    queryOne(
      `
      SELECT COUNT(*)::int AS n
      FROM new_seller_details sd
      WHERE sd.whatsapp_sent IS NOT TRUE
        AND ($1::uuid[] IS NULL OR NOT (sd.id = ANY($1::uuid[])))
        AND EXISTS (
          SELECT 1 FROM new_seller_information x
          WHERE x.seller_id = sd.id
            AND public.seller_mobile_digits(x.phone) IS NOT NULL
        )
      `,
      [excludeParam]
    ),
  ]);

  return {
    total_sellers: totalRow?.n || 0,
    sent_sellers: sentRow?.n || 0,
    eligible_sellers: eligibleRow?.n || 0,
  };
}

async function getLatestJob() {
  return queryOne(`
    SELECT ${JOB_COLUMNS}
    FROM seller_whatsapp_bulk_job wbj
    LEFT JOIN users u ON u.id = wbj.started_by
    ORDER BY wbj.created_at DESC, wbj.id DESC
    LIMIT 1
  `);
}

async function getRunningJob() {
  return queryOne(`
    SELECT ${JOB_COLUMNS}
    FROM seller_whatsapp_bulk_job wbj
    LEFT JOIN users u ON u.id = wbj.started_by
    WHERE wbj.status = 'running'
    ORDER BY wbj.created_at DESC, wbj.id DESC
    LIMIT 1
  `);
}

async function buildStatus() {
  const job = await getLatestJob();
  const [sentToday, counts] = await Promise.all([
    getTodaySendCount(),
    getSellerCounts(job?.status === 'running' ? job.processed_seller_ids : []),
  ]);

  return {
    job: job || null,
    is_running: job?.status === 'running',
    interval_seconds: SEND_INTERVAL_MS / 1000,
    sent_today: sentToday,
    daily_limit: job?.daily_limit || 0,
    total_sellers: counts.total_sellers,
    total_messages_sent: counts.sent_sellers,
    remaining_sellers: counts.eligible_sellers,
  };
}

async function findNextEligibleSeller(excludeIds = []) {
  return queryOne(
    `
    SELECT
      sd.id,
      sd.seller_id,
      sd.company_name,
      si.phone,
      public.seller_mobile_digits(si.phone) AS mobile_digits
    FROM new_seller_details sd
    JOIN LATERAL (
      SELECT x.phone
      FROM new_seller_information x
      WHERE x.seller_id = sd.id
        AND public.seller_mobile_digits(x.phone) IS NOT NULL
      ORDER BY x.id
      LIMIT 1
    ) si ON TRUE
    WHERE sd.whatsapp_sent IS NOT TRUE
      AND ($1::uuid[] IS NULL OR NOT (sd.id = ANY($1::uuid[])))
    ORDER BY sd.total_contracts DESC NULLS LAST, sd.seller_id ASC
    LIMIT 1
    `,
    [toUuidParam(excludeIds)]
  );
}

async function updateJob(jobId, fields) {
  const entries = Object.entries(fields);
  if (!entries.length) return null;

  const sets = entries.map(([key], index) => `${key} = $${index + 2}`);
  const values = entries.map(([, value]) => value);

  return queryOne(
    `
    UPDATE seller_whatsapp_bulk_job
    SET
      ${sets.join(',\n      ')},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id
    `,
    [jobId, ...values]
  );
}

async function sendOneSeller(row, { startedBy = null } = {}) {
  const destination = WhatsApp.toWhatsAppDestination(row.phone || row.mobile_digits);
  const userName = String(row.company_name || row.seller_id || '').trim() || 'Seller';
  const campaignName = WhatsApp.getConfig().campaignName;

  if (!destination) {
    return {
      success: false,
      skipped: true,
      reason: 'invalid_phone',
      destination: null,
      company_name: userName,
      message: 'Seller has no valid mobile number',
    };
  }

  const sendResult = await WhatsApp.sendCampaignMessage(destination, {
    userName,
    campaignName,
    source: 'whatsapp-bulk',
  });

  if (!sendResult.success) {
    return {
      success: false,
      skipped: Boolean(sendResult.skipped),
      reason: sendResult.reason || 'api_error',
      company_name: userName,
      destination,
      message: sendResult.message
        || (sendResult.reason === 'invalid_destination'
          ? `Invalid mobile number ${destination} — skipped`
          : 'Failed to send WhatsApp message'),
      data: sendResult.data ?? null,
    };
  }

  const resolvedDestination = sendResult.destination || destination;
  const log = await queryOne(
    `
    INSERT INTO seller_whatsapp_log (
      seller_id,
      gem_seller_id,
      company_name,
      destination,
      phone,
      campaign_name,
      source,
      response_payload,
      sent_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'whatsapp-bulk', $7::jsonb, $8)
    RETURNING id, sent_at
    `,
    [
      row.id,
      row.seller_id,
      userName.slice(0, 255),
      resolvedDestination,
      resolvedDestination,
      sendResult.campaignName || campaignName,
      JSON.stringify(sendResult.data ?? {}),
      startedBy || null,
    ]
  );

  await pool.query(
    `
    UPDATE new_seller_details
    SET
      whatsapp_sent = TRUE,
      whatsapp_sent_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [row.id]
  );

  return {
    success: true,
    skipped: false,
    company_name: userName,
    campaign: sendResult.campaignName || campaignName,
    destination: resolvedDestination,
    data: sendResult.data ?? null,
    log,
  };
}

async function completeJob(jobId, status, lastError = null) {
  const fields = {
    status,
    completed_at: new Date(),
    last_error: lastError,
  };
  if (status === 'stopped') {
    fields.stopped_at = new Date();
  }
  return updateJob(jobId, fields);
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNextTick(delayMs = SEND_INTERVAL_MS) {
  clearTimer();
  timer = setTimeout(() => {
    processTick().catch((error) => {
      console.error('WhatsApp bulk tick failed', error?.message);
    });
  }, delayMs);
}

async function processTick() {
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const job = await getRunningJob();
    if (!job) {
      clearTimer();
      return;
    }

    const jobLimit = job.daily_limit || 0;
    if (jobLimit > 0 && (job.sent_count || 0) >= jobLimit) {
      await completeJob(job.id, 'completed', null);
      clearTimer();
      return;
    }

    const processedIds = asUuidArray(job.processed_seller_ids);
    const nextSeller = await findNextEligibleSeller(processedIds);
    if (!nextSeller) {
      await completeJob(job.id, 'completed', null);
      clearTimer();
      return;
    }

    const sendOutcome = await sendOneSeller(nextSeller, {
      startedBy: job.started_by || null,
    });
    const nextProcessed = [...new Set([...processedIds, nextSeller.id])];

    if (sendOutcome.success) {
      await updateJob(job.id, {
        sent_count: (job.sent_count || 0) + 1,
        processed_seller_ids: nextProcessed,
        last_company_name: sendOutcome.company_name,
        last_destination: sendOutcome.destination || null,
        last_error: null,
      });
      console.log('[WhatsApp bulk] sent', {
        job_id: job.id,
        seller_id: nextSeller.seller_id,
        company: sendOutcome.company_name,
        destination: sendOutcome.destination,
      });
    } else if (sendOutcome.skipped) {
      await updateJob(job.id, {
        skipped_count: (job.skipped_count || 0) + 1,
        processed_seller_ids: nextProcessed,
        last_company_name: sendOutcome.company_name,
        last_destination: sendOutcome.destination || null,
        last_error: sendOutcome.message || 'Skipped',
      });
    } else {
      await updateJob(job.id, {
        failed_count: (job.failed_count || 0) + 1,
        processed_seller_ids: nextProcessed,
        last_company_name: sendOutcome.company_name,
        last_destination: sendOutcome.destination || null,
        last_error: sendOutcome.message || 'Send failed',
      });
      console.log('[WhatsApp bulk] failed', {
        job_id: job.id,
        seller_id: nextSeller.seller_id,
        destination: sendOutcome.destination,
        message: sendOutcome.message,
      });
    }

    const refreshed = await getRunningJob();
    if (!refreshed) {
      clearTimer();
      return;
    }

    const refreshedLimit = refreshed.daily_limit || 0;
    if (refreshedLimit > 0 && (refreshed.sent_count || 0) >= refreshedLimit) {
      await completeJob(refreshed.id, 'completed', null);
      clearTimer();
      return;
    }

    scheduleNextTick(SEND_INTERVAL_MS);
  } catch (error) {
    console.error('WhatsApp bulk tick failed', error?.message);
    scheduleNextTick(SEND_INTERVAL_MS);
  } finally {
    tickInFlight = false;
  }
}

async function startBulkJob({ dailyLimit, startedBy }) {
  const running = await getRunningJob();
  if (running) {
    const error = new Error('A WhatsApp bulk job is already running');
    error.code = 'ALREADY_RUNNING';
    error.job = running;
    throw error;
  }

  const whatsappConfig = WhatsApp.getConfig();
  if (!whatsappConfig.apiKey) {
    const error = new Error(
      'WhatsApp is not configured. Set WHATSAPP_SERVICE_API_KEY in backend/.env'
    );
    error.code = 'CONFIG';
    throw error;
  }

  const counts = await getSellerCounts();
  if (counts.eligible_sellers === 0) {
    const error = new Error(
      'No sellers with a valid phone number are currently eligible for WhatsApp messaging.'
    );
    error.code = 'NO_ELIGIBLE';
    error.details = counts;
    throw error;
  }

  if (dailyLimit > counts.eligible_sellers) {
    const error = new Error(
      `Limit ${dailyLimit} is more than the ${counts.eligible_sellers} remaining seller(s). Set the limit to ${counts.eligible_sellers} or less.`
    );
    error.code = 'LIMIT_EXCEEDS_REMAINING';
    error.details = {
      requested_daily_limit: dailyLimit,
      remaining_sellers: counts.eligible_sellers,
      ...counts,
    };
    throw error;
  }

  await queryOne(
    `
    INSERT INTO seller_whatsapp_bulk_job (
      status,
      daily_limit,
      sent_count,
      skipped_count,
      failed_count,
      processed_seller_ids,
      started_by,
      started_at
    )
    VALUES ('running', $2, 0, 0, 0, ARRAY[]::uuid[], $1, CURRENT_TIMESTAMP)
    RETURNING id
    `,
    [startedBy, dailyLimit]
  );

  scheduleNextTick(1_000);
  return buildStatus();
}

async function stopBulkJob() {
  const running = await getRunningJob();
  if (!running) return buildStatus();
  await completeJob(running.id, 'stopped', 'Stopped by user');
  clearTimer();
  return buildStatus();
}

async function getBulkStatus() {
  return buildStatus();
}

async function resumeIfRunning() {
  try {
    const running = await getRunningJob();
    if (!running) return false;
    console.log(`Resuming WhatsApp bulk job #${running.id}`);
    scheduleNextTick(2_000);
    return true;
  } catch (error) {
    if (error?.code === '42P01') return false;
    throw error;
  }
}

module.exports = {
  SEND_INTERVAL_MS,
  startBulkJob,
  stopBulkJob,
  getBulkStatus,
  resumeIfRunning,
};
