const express = require('express');
const multer = require('multer');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired, permissionRequired } = require('@/middleware/auth');
const listBuyerLeads = require('@/components/buyerLeads/listBuyerLeads');
const uploadBuyerLeads = require('@/components/buyerLeads/uploadBuyerLeads');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

const router = express.Router();
router.use(authRequired);
router.use(staffRequired);
router.use(permissionRequired('buyer_leads'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!ok) {
      return cb(new ServerError('Only CSV or Excel files are allowed', 400, ErrorCode.BAD_REQUEST));
    }
    return cb(null, true);
  },
});

router
  .route('/')
  .get(validate(listBuyerLeads.validationSchema), withDatabase(listBuyerLeads.controller));

router.route('/upload').post(upload.single('file'), withDatabase(uploadBuyerLeads.controller));

module.exports = router;
