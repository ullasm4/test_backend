const LEAD_STATUSES = Object.freeze([
  'new',
  'contacted',
  'interested',
  'follow_up',
  'reminder',
  'qualified',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
  'not_interested',
  'invalid',
]);

/** Statuses that require a follow-up date (remark optional). */
const LEAD_STATUSES_REQUIRING_FOLLOW_UP = Object.freeze(['reminder']);

module.exports = {
  LEAD_STATUSES,
  LEAD_STATUSES_REQUIRING_FOLLOW_UP,
};
