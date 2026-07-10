# DispatchPay REST API Specification

This document provides a comprehensive REST API specification for **DispatchPay**. All endpoints are prefixed with `/api/v1` (except the root `/health` check). 

---

## 1. Authentication Endpoints (`/auth`)

### Register Business
*   **URL**: `/auth/business/register`
*   **Method**: `POST`
*   **Authentication**: None
*   **Request Body (Zod Validation)**:
    ```json
    {
      "businessName": "Express Delivery Ltd",
      "businessEmail": "info@expressdelivery.com",
      "adminEmail": "owner@expressdelivery.com",
      "adminPassword": "SecurePassword123!",
      "adminName": "John Doe"
    }
    ```
*   **Response (201 Created)**:
    ```json
    {
      "businessId": "biz_7a2b9c...",
      "userId": "usr_9c8d7e...",
      "message": "Business registered successfully. Please check your email to verify."
    }
    ```
*   **Possible Errors**:
    *   `400 Bad Request`: Validation failure (email format invalid, weak password).
    *   `409 Conflict`: Business or admin email already exists in the system.

### Login Business User
*   **URL**: `/auth/business/login`
*   **Method**: `POST`
*   **Authentication**: None
*   **Request Body (Zod Validation)**:
    ```json
    {
      "email": "owner@expressdelivery.com",
      "password": "SecurePassword123!"
    }
    ```
*   **Response (200 OK)**:
    *   **Headers**: `Set-Cookie: refreshToken=jwt_hash; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh; Max-Age=604800`
    *   **Body**:
        ```json
        {
          "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          "expiresIn": 900,
          "user": {
            "id": "usr_9c8d7e...",
            "name": "John Doe",
            "email": "owner@expressdelivery.com",
            "role": "BUSINESS_OWNER",
            "businessId": "biz_7a2b9c..."
          }
        }
        ```
*   **Possible Errors**:
    *   `401 Unauthorized`: Invalid email or password.
    *   `403 Forbidden`: Account is inactive or suspended.

### Register Rider Profile
*   **URL**: `/auth/rider/register`
*   **Method**: `POST`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER` or `BUSINESS_MANAGER`)
*   **Request Body (Zod Validation)**:
    ```json
    {
      "firstName": "Kwame",
      "lastName": "Mensah",
      "phoneNumber": "+233240123456",
      "vehicleType": "MOTORCYCLE",
      "vehiclePlate": "M-24-GW82",
      "momoNetwork": "MTN",
      "momoNumber": "+233240123456"
    }
    ```
*   **Response (201 Created)**:
    ```json
    {
      "riderId": "usr_rider123...",
      "businessId": "biz_7a2b9c...",
      "message": "Rider account provisioned successfully."
    }
    ```
*   **Possible Errors**:
    *   `401 Unauthorized`: Invalid or expired JWT.
    *   `403 Forbidden`: Insufficient permissions (not a business admin).
    *   `409 Conflict`: Phone number already registered.

### Request Rider Login OTP
*   **URL**: `/auth/rider/login-otp`
*   **Method**: `POST`
*   **Authentication**: None
*   **Request Body (Zod Validation)**:
    ```json
    {
      "phoneNumber": "+233240123456"
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "otpId": "otp_abc123...",
      "message": "Verification code dispatched via SMS."
    }
    ```
*   **Possible Errors**:
    *   `400 Bad Request`: Phone number format invalid.
    *   `404 Not Found`: Rider phone number not registered under any business.
    *   `429 Too Many Requests`: OTP request limits exceeded.

### Verify Rider OTP & Login
*   **URL**: `/auth/rider/verify-otp`
*   **Method**: `POST`
*   **Authentication**: None
*   **Request Body (Zod Validation)**:
    ```json
    {
      "phoneNumber": "+233240123456",
      "otpId": "otp_abc123...",
      "code": "847291"
    }
    ```
*   **Response (200 OK)**:
    *   **Headers**: `Set-Cookie: refreshToken=jwt_hash; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh; Max-Age=604800`
    *   **Body**:
        ```json
        {
          "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          "expiresIn": 900,
          "rider": {
            "id": "usr_rider123...",
            "firstName": "Kwame",
            "lastName": "Mensah",
            "phoneNumber": "+233240123456",
            "role": "RIDER",
            "businessId": "biz_7a2b9c..."
          }
        }
        ```
*   **Possible Errors**:
    *   `400 Bad Request`: Incorrect, expired, or previously used OTP code.
    *   `404 Not Found`: Invalid verification session ID.

### Refresh Access Token
*   **URL**: `/auth/refresh`
*   **Method**: `POST`
*   **Authentication**: Refresh Token (HttpOnly Cookie)
*   **Request Body**: None (Reads cookie)
*   **Response (200 OK)**:
    *   **Headers**: `Set-Cookie: refreshToken=new_jwt_hash; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh; Max-Age=604800`
    *   **Body**:
        ```json
        {
          "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          "expiresIn": 900
        }
        ```
*   **Possible Errors**:
    *   `401 Unauthorized`: No refresh token cookie, or signature expired/revoked.
    *   `403 Forbidden`: Token reuse detected (all sessions invalidated).

### Secure Logout
*   **URL**: `/auth/logout`
*   **Method**: `POST`
*   **Authentication**: JWT Required
*   **Request Body**: None
*   **Response (200 OK)**:
    *   **Headers**: `Set-Cookie: refreshToken=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh; Max-Age=0`
    *   **Body**:
        ```json
        {
          "message": "Logged out successfully. Session invalidated."
        }
        ```
*   **Possible Errors**:
    *   `401 Unauthorized`: Bearer token missing/invalid.

---

## 2. Business Management Endpoints (`/businesses`)

### Get Current Business Profile
*   **URL**: `/businesses/me`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER`, `BUSINESS_MANAGER`)
*   **Response (200 OK)**:
    ```json
    {
      "id": "biz_7a2b9c...",
      "name": "Express Delivery Ltd",
      "email": "info@expressdelivery.com",
      "createdAt": "2026-07-10T12:00:00Z",
      "updatedAt": "2026-07-10T12:00:00Z"
    }
    ```
*   **Possible Errors**:
    *   `401 Unauthorized`: Access token missing/invalid.

### Get Business Wallet & Ledger
*   **URL**: `/businesses/me/wallet`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER` or `BUSINESS_MANAGER`)
*   **Response (200 OK)**:
    ```json
    {
      "walletId": "wlt_91a82d...",
      "balanceMinor": 105000, // 1,050.00 GHS
      "currency": "GHS",
      "updatedAt": "2026-07-10T12:30:15Z"
    }
    ```

---

## 3. Rider Management Endpoints (`/riders`)

### List Business Riders
*   **URL**: `/riders`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER`, `BUSINESS_MANAGER`)
*   **Request Params**:
    *   `page` (default: 1), `limit` (default: 10), `isActive` (boolean, optional)
*   **Response (200 OK)**:
    ```json
    {
      "data": [
        {
          "id": "usr_rider123...",
          "firstName": "Kwame",
          "lastName": "Mensah",
          "phoneNumber": "+233240123456",
          "vehicleType": "MOTORCYCLE",
          "vehiclePlate": "M-24-GW82",
          "momoNetwork": "MTN",
          "isActive": true
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 10,
        "totalItems": 1,
        "totalPages": 1
      }
    }
    ```

### Get Single Rider Details
*   **URL**: `/riders/:id`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Tenant isolation verified - Rider must belong to user's business, or context user is the rider themselves)
*   **Response (200 OK)**:
    ```json
    {
      "id": "usr_rider123...",
      "businessId": "biz_7a2b9c...",
      "firstName": "Kwame",
      "lastName": "Mensah",
      "phoneNumber": "+233240123456",
      "vehicleType": "MOTORCYCLE",
      "vehiclePlate": "M-24-GW82",
      "momoNetwork": "MTN",
      "momoNumber": "+233240123456",
      "isActive": true,
      "createdAt": "2026-07-10T12:00:00Z"
    }
    ```
*   **Possible Errors**:
    *   `404 Not Found`: Rider does not exist or does not belong to the business.

### Update Rider Info
*   **URL**: `/riders/:id`
*   **Method**: `PATCH`
*   **Authentication**: JWT Required (Tenant isolation checked)
*   **Request Body (Zod Validation)**:
    ```json
    {
      "vehicleType": "MOTORCYCLE",
      "vehiclePlate": "M-24-GW90",
      "momoNetwork": "MTN",
      "momoNumber": "+233240999999",
      "isActive": true
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "id": "usr_rider123...",
      "message": "Rider profile updated successfully."
    }
    ```

### Get Rider Wallet & Ledger
*   **URL**: `/riders/:id/wallet`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Tenant Isolation checked - Rider can query own wallet; Business admins can query their riders' wallets)
*   **Response (200 OK)**:
    ```json
    {
      "walletId": "wlt_rdr_829aa...",
      "balanceMinor": 35000, // 350.00 GHS
      "currency": "GHS",
      "ledger": [
        {
          "id": "led_982a...",
          "type": "CREDIT",
          "amountMinor": 2500, // 25.00 GHS commission
          "balanceAfterMinor": 35000,
          "referenceType": "DELIVERY_COMMISSION",
          "referenceId": "del_726a...",
          "description": "Delivery delivery fee payment share",
          "createdAt": "2026-07-10T12:15:00Z"
        }
      ]
    }
    ```

---

## 4. Delivery Endpoints (`/deliveries`)

### Create Delivery Request
*   **URL**: `/deliveries`
*   **Method**: `POST`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER`, `BUSINESS_MANAGER`)
*   **Request Body (Zod Validation)**:
    ```json
    {
      "pickupAddress": "12 Ring Road Central, Accra",
      "deliveryAddress": "45 Liberation Road, Airport Residential Area, Accra",
      "pickupLatitude": 5.5601,
      "pickupLongitude": -0.2012,
      "deliveryLatitude": 5.6023,
      "deliveryLongitude": -0.1764,
      "distanceKm": 6.2,
      "feeAmountMinor": 5000, // 50.00 GHS delivery fee charged
      "commissionAmountMinor": 1000, // 10.00 GHS business share
      "payoutAmountMinor": 4000, // 40.00 GHS rider payout share
      "riderId": "usr_rider123..." // Optional (creates as PENDING if null)
    }
    ```
*   **Response (201 Created)**:
    ```json
    {
      "deliveryId": "del_726a...",
      "trackingNumber": "DP-20260710-X92B",
      "status": "ASSIGNED",
      "createdAt": "2026-07-10T12:45:00Z"
    }
    ```

### List Deliveries
*   **URL**: `/deliveries`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Tenant isolation automatically forced based on token `business_id` / Rider retrieves only assigned deliveries)
*   **Request Params**:
    *   `page` (default: 1), `limit` (default: 10), `status` (PENDING, ASSIGNED, etc.), `riderId` (optional)
*   **Response (200 OK)**:
    ```json
    {
      "data": [
        {
          "id": "del_726a...",
          "trackingNumber": "DP-20260710-X92B",
          "status": "ASSIGNED",
          "pickupAddress": "12 Ring Road Central, Accra",
          "deliveryAddress": "45 Liberation Road...",
          "payoutAmountMinor": 4000,
          "createdAt": "2026-07-10T12:45:00Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 10,
        "totalItems": 1,
        "totalPages": 1
      }
    }
    ```

### Update Delivery Status (State Machine Change)
*   **URL**: `/deliveries/:id/status`
*   **Method**: `PATCH`
*   **Authentication**: JWT Required (Tenant checked; Riders can change status of assigned tasks; Business admins can change any status within tenant)
*   **Request Body (Zod Validation)**:
    ```json
    {
      "status": "PICKED_UP", // PICKED_UP, DELIVERED, CANCELLED
      "latitude": 5.5612, // GPS coordinates tracking
      "longitude": -0.2005,
      "notes": "Package secure. Heading to delivery destination."
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "deliveryId": "del_726a...",
      "status": "PICKED_UP",
      "message": "Delivery status transitioned successfully."
    }
    ```
*   **Possible Errors**:
    *   `400 Bad Request`: Invalid state transition request (e.g. attempting to skip from `PENDING` straight to `DELIVERED`).

### Assign Rider
*   **URL**: `/deliveries/:id/assign`
*   **Method**: `PATCH`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER` or `BUSINESS_MANAGER`)
*   **Request Body (Zod Validation)**:
    ```json
    {
      "riderId": "usr_rider123..."
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "deliveryId": "del_726a...",
      "riderId": "usr_rider123...",
      "status": "ASSIGNED",
      "message": "Rider successfully assigned to delivery task."
    }
    ```

---

## 5. Payment (Funding) Endpoints (`/payments`)

### Initiate Wallet Funding
*   **URL**: `/payments/fund-wallet`
*   **Method**: `POST`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER`)
*   **Request Body (Zod Validation)**:
    ```json
    {
      "amountMinor": 250000, // 2,500.00 GHS funding amount
      "paymentMethod": "MOMO", // MOMO, CARD, BANK
      "recipientPhoneNumber": "+233240111222", // Source wallet for MoMo
      "recipientNetwork": "MTN"
    }
    ```
*   **Response (202 Accepted)**:
    ```json
    {
      "paymentId": "pay_551a...",
      "status": "PENDING",
      "providerReference": "moolre_funding_ref_98218",
      "message": "Wallet funding initialized. Check mobile device for MoMo prompt authentication."
    }
    ```

### List Funding Transactions
*   **URL**: `/payments`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER`)
*   **Response (200 OK)**:
    ```json
    {
      "data": [
        {
          "id": "pay_551a...",
          "amountMinor": 250000,
          "status": "PENDING",
          "paymentMethod": "MOMO",
          "createdAt": "2026-07-10T12:40:00Z"
        }
      ]
    }
    ```

### Moolre Funding Webhook Callback
*   **URL**: `/payments/webhook`
*   **Method**: `POST`
*   **Authentication**: Encrypted Webhook Verification (`X-Moolre-Signature`)
*   **Request Body (From Provider)**:
    ```json
    {
      "transactionReference": "moolre_funding_ref_98218",
      "status": "SUCCESS",
      "amount": 2500.00,
      "charge": 25.00,
      "timestamp": "2026-07-10T12:42:00Z"
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "received": true
    }
    ```

---

## 6. Payout Endpoints (`/payouts`)

### Initiate Payout Request (Withdrawal)
*   **URL**: `/payouts/request`
*   **Method**: `POST`
*   **Authentication**: JWT Required (Role: `RIDER` requesting own cashout, or `BUSINESS_OWNER` triggering batch payouts)
*   **Request Body (Zod Validation)**:
    ```json
    {
      "amountMinor": 10000, // 100.00 GHS
      "otpCode": "192834" // OTP Code required from phone for 2FA validation
    }
    ```
*   **Response (202 Accepted)**:
    ```json
    {
      "payoutId": "poy_8321a...",
      "status": "PENDING",
      "message": "Payout requested. Awaiting administrator release authorization."
    }
    ```
*   **Possible Errors**:
    *   `402 Payment Required`: Insufficient rider balance to execute payout.
    *   `400 Bad Request`: Invalid OTP verification.

### Release/Approve Payout
*   **URL**: `/payouts/:id/approve`
*   **Method**: `POST`
*   **Authentication**: JWT Required (Role: `BUSINESS_OWNER` or `BUSINESS_MANAGER`)
*   **Request Body**: None
*   **Response (202 Accepted)**:
    ```json
    {
      "payoutId": "poy_8321a...",
      "status": "PROCESSING",
      "message": "Payout approved. Transaction dispatched to Moolre network."
    }
    ```
*   **Possible Errors**:
    *   `404 Not Found`: Payout ticket does not exist or tenant mismatch.
    *   `422 Unprocessable Entity`: Business wallet has insufficient funds to cover the rider payout + gateway processing fees.

### Moolre Payout Webhook Callback
*   **URL**: `/payouts/webhook`
*   **Method**: `POST`
*   **Authentication**: Encrypted Webhook Verification (`X-Moolre-Signature`)
*   **Request Body (From Provider)**:
    ```json
    {
      "transferReference": "moolre_payout_ref_441829",
      "status": "SUCCESS",
      "amount": 100.00,
      "fee": 1.00,
      "timestamp": "2026-07-10T12:47:00Z"
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "received": true
    }
    ```

---

## 7. OTP & SMS Services (`/otp` / `/sms`)

### Send General OTP
*   **URL**: `/otp/send`
*   **Method**: `POST`
*   **Authentication**: None
*   **Request Body**:
    ```json
    {
      "phoneNumber": "+233240123456",
      "purpose": "PAYOUT_VERIFICATION" // LOGIN, PAYOUT_VERIFICATION, RESET_PASSWORD
    }
    ```
*   **Response (200 OK)**:
    ```json
    {
      "otpId": "otp_xyz987...",
      "message": "SMS OTP sent successfully."
    }
    ```

### Retrieve SMS Delivery Logs
*   **URL**: `/sms/logs`
*   **Method**: `GET`
*   **Authentication**: JWT Required (Role: `SUPER_ADMIN`, `BUSINESS_OWNER` for auditing SMS costs)
*   **Response (200 OK)**:
    ```json
    {
      "logs": [
        {
          "id": "sms_9281a...",
          "phoneNumber": "+233240123456",
          "message": "Your OTP code is 987629. Valid for 5 minutes.",
          "status": "DELIVERED",
          "createdAt": "2026-07-10T12:30:00Z"
        }
      ]
    }
    ```

---

## 8. System Diagnostics (`/health`)

### Service Health Check
*   **URL**: `/health`
*   **Method**: `GET`
*   **Authentication**: None
*   **Response (200 OK)**:
    ```json
    {
      "status": "healthy",
      "timestamp": "2026-07-10T12:46:00Z",
      "version": "1.0.0",
      "services": {
        "database": "connected",
        "redis": "connected",
        "moolreApi": "up"
      }
    }
    ```
*   **Response (503 Service Unavailable)**:
    *   Returned if any critical database or caching channel drops connection.
    ```json
    {
      "status": "unhealthy",
      "timestamp": "2026-07-10T12:46:00Z",
      "services": {
        "database": "disconnected",
        "redis": "connected",
        "moolreApi": "up"
      }
    }
    ```
