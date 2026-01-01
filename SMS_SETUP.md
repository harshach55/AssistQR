# SMS Setup Guide - Twilio Configuration

## Quick Setup Steps

### 1. Create Twilio Account
1. Go to https://www.twilio.com/try-twilio
2. Sign up for a free account (includes $15.50 credit)
3. Verify your email and phone number

### 2. Get Your Twilio Credentials

**From Twilio Console Dashboard:**
- **Account SID**: Found on dashboard (starts with `AC...`)
- **Auth Token**: Click "Show" to reveal (starts with your auth token)
- **Phone Number**: 
  - Go to **Phone Numbers** → **Manage** → **Buy a number**
  - Choose a number (free trial numbers available)
  - Format: Must be in E.164 format (e.g., `+1234567890`)

### 3. Add to Render Dashboard

1. Go to https://dashboard.render.com
2. Select your **assistqr** service
3. Click **Environment** tab
4. Add these three environment variables:

```
TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN = your_auth_token_here
TWILIO_FROM_NUMBER = +1234567890
```

**Important:** 
- Replace with your actual values
- Phone number MUST include `+` and country code
- Example: `+919876543210` (India), `+1234567890` (USA)

### 4. Redeploy

After adding environment variables, Render will automatically redeploy. Or manually trigger a redeploy.

### 5. Test SMS

1. Add an emergency contact with a phone number in E.164 format
2. Submit an accident report
3. Check if SMS is received

## Phone Number Format (E.164)

**Required Format:** `+[country code][number]`

**Examples:**
- USA: `+1234567890`
- India: `+919876543210`
- UK: `+447911123456`

**Important Notes:**
- Must start with `+`
- No spaces, dashes, or parentheses
- Include country code
- Emergency contacts must use this format when adding contacts

## Troubleshooting

### SMS Not Sending?

1. **Check Twilio Console Logs**
   - Go to Twilio Console → Monitor → Logs
   - Look for error messages

2. **Common Errors:**
   - **Error 21211**: Invalid phone number format → Use E.164 format
   - **Error 21608**: No permission to send to this number → Verify number in Twilio
   - **Error 21614**: Invalid "from" number → Check TWILIO_FROM_NUMBER
   - **Error 20003**: Authentication failed → Check Account SID and Auth Token

3. **Check Environment Variables**
   - Verify all three variables are set in Render
   - Check server logs for "✅ Twilio SMS service is ready" message

4. **Twilio Account Status**
   - Free trial accounts can only send to verified numbers
   - Upgrade account to send to any number

## Cost Information

- **Free Trial**: $15.50 credit included
- **SMS Pricing**: ~$0.0075 per SMS (varies by country)
- **Phone Number**: Free on trial, ~$1/month after trial

## Need Help?

- Twilio Docs: https://www.twilio.com/docs
- Twilio Support: Available in dashboard

