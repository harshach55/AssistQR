// Local File Storage Service
// Fallback storage when S3 is not configured (for development)

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'accidents');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
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

// Upload multiple files
const uploadMultiple = upload.array('images', 10);

function getFileUrl(filename) {
  if (!filename) return null;
  if (filename.startsWith('http')) return filename; // Already a full URL
  
  // Generate URL for local file
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/uploads/accidents/${filename}`;
}

function getFilePath(filename) {
  return path.join(uploadsDir, filename);
}

module.exports = {
  uploadMultiple,
  getFileUrl,
  getFilePath
};

