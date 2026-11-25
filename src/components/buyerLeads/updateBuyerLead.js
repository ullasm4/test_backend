const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const {
  cleanText,
  normalizeEmailList,
  normalizePhoneList,
  toDbArray,
} = require('@/lib/buyerLeadContacts');

const contactListSchema = Joi.alternatives()
  .try(
    Joi.array().items(Joi.string().trim().allow('')).max(20),
    Joi.string().trim().allow('', null)
  )
  .optional();

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    sr_no: Joi.number().integer().allow(null).optional(),
    name: Joi.string().trim().min(1).max(500).required(),
    phone: contactListSchema,
    email: contactListSchema,
    website: Joi.string().trim().max(2000).allow('', null).optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const name = cleanText(req.body.name);
  if (!name) {
    throw new ServerError('Name is required', 400, ErrorCode.BAD_REQUEST);
  }

  const phones = normalizePhoneList(req.body.phone);
  const emails = normalizeEmailList(req.body.email);
  const website = cleanText(req.body.website);
  const srNo =
    req.body.sr_no === null || req.body.sr_no === undefined || req.body.sr_no === ''
      ? null
      : Number(req.body.sr_no);

  if (emails.length) {
    const emailKeys = emails.map((email) => email.toLowerCase());
    const dup = await db.query(
      `
        SELECT bl.id, e.email
        FROM buyer_lead bl
        CROSS JOIN LATERAL unnest(COALESCE(bl.email, ARRAY[]::text[])) AS e(email)
        WHERE bl.id <> $1
          AND e.email IS NOT NULL
          AND BTRIM(e.email) <> ''
          AND LOWER(BTRIM(e.email)) = ANY($2::text[])
        LIMIT 1
      `,
      [req.params.id, emailKeys]
    );
    if (dup.rows[0]) {
      throw new ServerError(
        `Another lead already uses email ${dup.rows[0].email}`,
        409,
        ErrorCode.CONFLICT
      );
    }
  }

  const { rows } = await db.query(
    `
      UPDATE buyer_lead
      SET
        sr_no = $2,
        name = $3,
        phone = $4::text[],
        email = $5::text[],
        website = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING
        id,
        sr_no,
        name,
        COALESCE(phone, ARRAY[]::text[]) AS phone,
        COALESCE(email, ARRAY[]::text[]) AS email,
        website,
        created_at,
        updated_at
    `,
    [
      req.params.id,
      Number.isFinite(srNo) ? srNo : null,
      name,
      toDbArray(phones),
      toDbArray(emails),
      website,
    ]
  );

  if (!rows[0]) {
    throw new ServerError('Buyer lead not found', 404, ErrorCode.NOT_FOUND);
  }

  return res.status(200).json(rows[0]);
};
