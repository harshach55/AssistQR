# Vehicle Safety QR System

A complete MVP for a vehicle safety system using QR codes. In case of an accident, bystanders can scan the QR code on a vehicle, share location and photos, and the system automatically notifies emergency contacts via email and SMS.

## Features

- **User Authentication**: Secure signup/login with session management
- **Vehicle Management**: Add and manage vehicles with unique QR codes
- **Emergency Contacts**: Add multiple emergency contacts per vehicle
- **QR Code Generation**: Generate and download QR codes for vehicles
- **Accident Reporting**: Public-facing page for bystanders to report accidents
- **Geolocation**: Automatic location capture using browser Geolocation API
- **Photo Upload**: Upload multiple photos (stored on S3)
- **Email Notifications**: Automated email alerts via SMTP
- **SMS Notifications**: Automated SMS alerts via Twilio
- **Privacy-First**: QR codes contain only secure tokens, no sensitive data exposed

## Tech Stack

- **Backend**: Node.js with Express
- **Database**: MySQL with Prisma ORM
- **Authentication**: Sessions with bcrypt password hashing
- **File Storage**: AWS S3 (abstracted service layer)
- **Email**: Nodemailer with SMTP
- **SMS**: Twilio
- **QR Code**: Server-side generation with `qrcode` package
- **Frontend**: Plain HTML, CSS, and vanilla JavaScript (EJS templates)
- **Validation**: express-validator

## Prerequisites

- Node.js (v14 or higher)
- MySQL (v8 or higher)
- AWS S3 account (or S3-compatible storage)
- SMTP email account (Gmail, SendGrid, etc.)
- Twilio account (for SMS)

## Installation

1. **Clone or download the project**

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the root directory:
   ```env
   # Server Configuration
   PORT=3000
   SESSION_SECRET=your-super-secret-session-key-change-this
   BASE_URL=http://localhost:3000

   # Database Configuration (MySQL)
   DATABASE_URL="mysql://user:password@localhost:3306/vehicle_safety_db"

   # SMTP Email Configuration
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   SMTP_FROM=noreply@yourservice.com

   # Twilio SMS Configuration
   TWILIO_ACCOUNT_SID=your-twilio-account-sid
   TWILIO_AUTH_TOKEN=your-twilio-auth-token
   TWILIO_FROM_NUMBER=+1234567890

   # AWS S3 Configuration
   S3_ACCESS_KEY_ID=your-s3-access-key
   S3_SECRET_ACCESS_KEY=your-s3-secret-key
   S3_BUCKET=your-bucket-name
   S3_REGION=us-east-1

   # Environment
   NODE_ENV=development
   ```

4. **Set up the database**:
   ```bash
   # Generate Prisma client
   npm run prisma:generate

   # Run migrations to create database tables
   npm run prisma:migrate
   ```

5. **Start the server**:
   ```bash
   # Development mode (with nodemon)
   npm run dev

   # Production mode
   npm start
   ```

6. **Access the application**:
   Open your browser and navigate to `http://localhost:3000`

## Environment Variables

### Required Variables

- `DATABASE_URL`: MySQL connection string
- `SESSION_SECRET`: Secret key for session encryption
- `BASE_URL`: Base URL of your application (for QR code URLs)

### Email Configuration (SMTP)

- `SMTP_HOST`: SMTP server hostname
- `SMTP_PORT`: SMTP server port (usually 587 for TLS, 465 for SSL)
- `SMTP_USER`: SMTP username/email
- `SMTP_PASS`: SMTP password or app password
- `SMTP_FROM`: Sender email address

**Gmail Setup**:
- Use an "App Password" instead of your regular password
- Enable 2-factor authentication
- Generate app password from Google Account settings

### SMS Configuration (Twilio)

- `TWILIO_ACCOUNT_SID`: Your Twilio account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio auth token
- `TWILIO_FROM_NUMBER`: Your Twilio phone number (E.164 format, e.g., +1234567890)

**Note**: SMS functionality will be skipped if Twilio credentials are not configured.

### S3 Configuration

- `S3_ACCESS_KEY_ID`: AWS access key ID
- `S3_SECRET_ACCESS_KEY`: AWS secret access key
- `S3_BUCKET`: S3 bucket name
- `S3_REGION`: AWS region (e.g., us-east-1)

**S3 Bucket Setup**:
1. Create an S3 bucket
2. Enable public read access for accident photos
3. Configure CORS if needed
4. Create IAM user with S3 access permissions

## Database Schema

The system uses the following tables:

- `users`: User accounts
- `vehicles`: Vehicles with QR tokens
- `emergency_contacts`: Emergency contacts per vehicle
- `accident_reports`: Accident reports
- `accident_images`: Images linked to accident reports

See `prisma/schema.prisma` for detailed schema definitions.

## User Flow

### Vehicle Owner Flow

1. Sign up / Login
2. Add a vehicle (license plate, model, color)
3. Add emergency contacts (name, email, phone in E.164 format)
4. Generate and download QR code
5. Print and place QR code on vehicle

### Bystander / Accident Flow

1. Scan QR code on vehicle
2. Access accident reporting page
3. Share current location (optional but recommended)
4. Upload one or more photos
5. Add optional additional information
6. Submit report
7. System automatically notifies all emergency contacts via email and SMS

## Security Features

- Secure password hashing with bcrypt
- Session-based authentication
- QR tokens are UUIDs (non-guessable)
- No sensitive data in QR codes
- Input validation and sanitization
- Privacy: Emergency contacts never exposed to bystanders
- SQL injection protection via Prisma ORM

## API Endpoints

### Public Endpoints

- `GET /qr/help?v=<qrToken>` - Accident reporting page (public)
- `POST /accidents/report` - Submit accident report (public)

### Protected Endpoints (Require Login)

- `GET /auth/login` - Login page
- `POST /auth/login` - Login handler
- `GET /auth/signup` - Signup page
- `POST /auth/signup` - Signup handler
- `GET /auth/logout` - Logout

- `GET /vehicles` - List vehicles
- `GET /vehicles/add` - Add vehicle form
- `POST /vehicles/add` - Create vehicle
- `GET /vehicles/:id` - Vehicle details
- `POST /vehicles/:id/delete` - Delete vehicle

- `POST /contacts/add` - Add emergency contact (API)
- `POST /contacts/:id/delete` - Delete emergency contact (API)

- `GET /qr/:vehicleId/preview` - Preview QR code
- `GET /qr/:vehicleId/download` - Download QR code PNG

## Project Structure

```
.
├── config/
│   └── database.js          # Prisma client configuration
├── middleware/
│   └── auth.js              # Authentication middleware
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── vehicles.js          # Vehicle management routes
│   ├── contacts.js          # Emergency contact routes
│   ├── accidents.js         # Accident reporting routes
│   └── qr.js                # QR code routes
├── services/
│   ├── email.js             # Email service (nodemailer)
│   ├── sms.js               # SMS service (Twilio)
│   └── s3.js                # S3 file upload service
├── views/
│   ├── auth/                # Authentication templates
│   ├── vehicles/            # Vehicle management templates
│   ├── accidents/           # Accident reporting templates
│   ├── qr/                  # QR code templates
│   └── error.ejs            # Error page template
├── public/
│   └── css/
│       └── style.css        # Global styles
├── prisma/
│   └── schema.prisma        # Database schema
├── server.js                # Express server entry point
└── package.json
```

## Development

### Prisma Commands

```bash
# Generate Prisma client
npm run prisma:generate

# Create and run migrations
npm run prisma:migrate

# Open Prisma Studio (database GUI)
npm run prisma:studio
```

### Running in Development

```bash
npm run dev
```

This uses nodemon to auto-reload on file changes.

## Production Deployment

1. Set `NODE_ENV=production` in environment variables
2. Use a secure `SESSION_SECRET`
3. Configure production database
4. Set up proper S3 bucket with production settings
5. Configure production email/SMS services
6. Use HTTPS for production (update `BASE_URL`)
7. Consider using a process manager like PM2

## Troubleshooting

### Database Connection Issues
- Verify MySQL is running
- Check `DATABASE_URL` format: `mysql://user:password@host:port/database`
- Ensure database exists
- Check user permissions

### Email Not Sending
- Verify SMTP credentials
- Check firewall/network settings
- For Gmail, ensure app password is used (not regular password)
- Check email service logs

### SMS Not Sending
- Verify Twilio credentials
- Check phone number format (E.164)
- Verify Twilio account balance
- Check Twilio logs

### File Upload Issues
- Verify S3 credentials
- Check bucket permissions (public read for uploaded files)
- Verify bucket exists in specified region
- Check file size limits (10MB per file)

### QR Code Not Working
- Verify `BASE_URL` is correct
- Check QR token is valid in database
- Ensure QR code encodes full URL with token

## License

MIT

## Support

For issues or questions, please check the codebase documentation or create an issue.

