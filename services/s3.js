// File Storage Service (S3)
// Handles file uploads to AWS S3 or falls back to local storage

const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const BUCKET_NAME = process.env.S3_BUCKET;
const S3_CONFIGURED = !!(process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY && BUCKET_NAME);

let s3 = null;
let upload = null;
let uploadMultiple = null;

if (S3_CONFIGURED) {
  s3 = new AWS.S3({
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION || 'us-east-1'
  });

  // Configure multer for S3 uploads
  upload = multer({
    storage: multerS3({
      s3: s3,
      bucket: BUCKET_NAME,
      acl: 'public-read', // Make uploaded files publicly readable
      key: function (req, file, cb) {
        // Generate unique filename: accidents/{timestamp}-{uuid}-{originalname}
        const ext = path.extname(file.originalname);
        const filename = `accidents/${Date.now()}-${uuidv4()}${ext}`;
        cb(null, filename);
      },
      contentType: multerS3.AUTO_CONTENT_TYPE
    }),
    limits: {
      fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
      // Only accept image files
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'), false);
      }
    }
  });
} else {
  // Fallback to local file storage if S3 is not configured (for development)
  const fs = require('fs');
  const uploadsDir = path.join(__dirname, '..', 'uploads', 'accidents');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname);
      const filename = `${Date.now()}-${uuidv4()}${ext}`;
      cb(null, filename);
    }
  });
  
  upload = multer({
    storage: diskStorage,
    limits: {
      fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'), false);
      }
    }
  });
  console.warn('⚠️  S3 not configured. File uploads will be stored locally in ./uploads/accidents/. Configure S3 in .env for production.');
}

// Upload multiple files
uploadMultiple = upload.array('images', 10); // Max 10 images

// Get public URL for a file
function getFileUrl(key) {
  if (!key) return null;
  if (key.startsWith('http')) return key; // Already a full URL
  
  if (S3_CONFIGURED) {
    // S3 URL
    return `https://${BUCKET_NAME}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  } else {
    // Local file URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const filename = typeof key === 'string' ? key.split('/').pop() : key;
    return `${baseUrl}/uploads/accidents/${filename}`;
  }
}

module.exports = {
  uploadMultiple,
  getFileUrl,
  s3
};

