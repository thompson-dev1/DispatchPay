# DispatchPay Rider PWA Experience Design

This specification outlines the mobile-first Progressive Web App (PWA) design for the **DispatchPay Rider App**. The interface is optimized for one-handed operation (thumb zone) on Android devices, under sunlight, and with limited/intermittent network connections.

---

## 1. PWA Shell & Android Optimization

### Mobile Viewport & Target Guidelines
*   **Viewport Lock**: Prevent scaling and zooming issues under sunlight:
    ```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    ```
*   **Touch Target Size**: Every interactive element and button has a minimum height of **56px** to ensure easy tapping, even when the rider is wearing gloves or mounting their device.
*   **Thumb Zone Layout**: Primary actions (Accept Job, Status Transitions, Payout Requests) are placed strictly in the bottom 40% of the screen.

### Offline Resilience (Service Worker Architecture)
*   **Asset Caching (Cache-First)**: Renders the core app shell (index.html, bundles, local fonts) instantly from the Cache Storage API, bypassing network checks.
*   **IndexedDB Cache**: Stores current deliveries, earnings balance, and ledger items locally. If the network drops, the rider can still view their active schedule.
*   **Background Sync API**: Status updates (e.g., transitioning a delivery to `DELIVERED`) clicked offline are written to an IndexedDB queue. The Service Worker synchronizes the queue with the backend once connection is restored, preventing data loss.

---

## 2. Page Specifications & Wireframes

### Page A: Mobile Login

#### Wireframe Mockup
```
+------------------------------------------+
|               DISPATCHPAY                |
|                                          |
|  Welcome back, Rider.                    |
|  Enter your registered phone number.     |
|                                          |
|  Phone Number:                           |
|  +------------------------------------+  |
|  | +233  | [ 24 012 3456 ]            |  |
|  +------------------------------------+  |
|                                          |
|                                          |
|  +------------------------------------+  |
|  |             SEND OTP               |  |
|  +------------------------------------+  |
|                                          |
+------------------------------------------+
```

#### Core Components
*   **Tel Input Form**: Large text field with a pre-configured country code suffix picker (`+233` for Ghana, `+234` for Nigeria).
*   **Large Accent Button**: High-contrast block button at the bottom of the viewport.

#### UI States
*   **Validation check**: Button remains disabled until a valid 9 or 10-digit number is input.
*   **Loading state**: Button text changes to a spinning indicator wheel.

---

### Page B: OTP Verification

#### Wireframe Mockup
```
+------------------------------------------+
|               DISPATCHPAY                |
|                                          |
|  Verify Phone                            |
|  Sent 6-digit code to +233240123456      |
|                                          |
|  OTP Code:                               |
|  [ 8 ] [ 4 ] [ 7 ] [ 2 ] [ _ ] [ _ ]     |
|                                          |
|  +------------------------------------+  |
|  |            VERIFY & LOGIN          |  |
|  +------------------------------------+  |
|                                          |
|  Resend Code in 0:45                     |
+------------------------------------------+
```

#### Core Components
*   **Auto-focusing Inputs**: 6 individual box inputs that move focus automatically upon entry.
*   **Android OTP Autocomplete**: Integrated via standard autofill properties (`autocomplete="one-time-code"`) to parse SMS incoming codes directly.

---

### Page C: Assigned Jobs (Home Screen)

#### Wireframe Mockup
```
+------------------------------------------+
| [R] Kwame Mensah      [ GHS 340.00 ] ( E)|
|                                          |
| Active Deliveries                        |
|                                          |
| +--------------------------------------+ |
| | Pick: 12 Ring Road Central           | |
| | Drop: Cantonments, Accra             | |
| | Payout: GHS 40.00                    | |
| |                                      | |
| |             [ START JOB ]            | |
| +--------------------------------------+ |
|                                          |
| Pending Tasks                            |
| +--------------------------------------+ |
| | Drop: Airport Residential            | |
| | Payout: GHS 50.00                    | |
| +--------------------------------------+ |
+------------------------------------------+
```

#### Core Components
*   **Header Section**: Displays the rider's name, their available wallet balance, and a direct link to the Earnings (E) tab.
*   **Task List Cards**: Active cards are colored in contrasting neutral tones containing large text for addresses.
*   **Action Toggles**: Tapping "START JOB" moves the app directly to the Job Details screen.

#### UI States
*   **Offline Mode Indicator**: If offline, a yellow banner is pinned at the top: `[!] Operating Offline. Offline tasks cached.`
*   **Empty State**: "No assigned jobs. Enjoy your break!" Displayed with a refresh button.

---

### Page D: Job Details & Status Stepper

#### Wireframe Mockup
```
+------------------------------------------+
| < Back to Jobs       Tracking: DP-1092-A |
|                                          |
| PICKUP:                                  |
| 12 Ring Road Central, Accra              |
|                                          |
| DESTINATION:                             |
| Cantonments, Accra                       |
|                                          |
| CUSTOMER:                                |
| Joe Mensah (+233240000000) [Call]        |
|                                          |
| PAYOUT AMOUNT:                           |
| GHS 40.00 (Cash on Delivery)             |
|                                          |
| [==================== SLIDE TO PICK UP > ]
+------------------------------------------+
```

#### Core Components
*   **Customer Call CTA**: Double-sized touch buttons to dial the customer's phone number via standard `tel:` routing.
*   **Slide-to-Confirm Component**: A swipeable slider located at the bottom of the screen. Instead of a simple button tap (which is prone to accidental triggers during transit), riders must swipe right to transition states (e.g., Slide to Pick Up, Slide to Complete).
*   **Tactile Haptic Feedback**: Integrates the browser's Haptic Vibration API to pulse the device on swipe completion.
    ```javascript
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    ```

---

### Page E: Earnings & Cash-Out

#### Wireframe Mockup
```
+------------------------------------------+
| Earnings                                 |
|                                          |
| Available Balance:                       |
| GHS 340.00                               |
|                                          |
| Disburse to MTN MoMo:                    |
| +233 24 012 3456                         |
|                                          |
| +------------------------------------+  |
| |          REQUEST CASHOUT           |  |
| +------------------------------------+  |
|                                          |
| Recent Payouts                           |
| - GHS 120.00 (Success - 2026-07-09)      |
| - GHS 80.00  (Success - 2026-07-08)      |
+------------------------------------------+
```

#### Core Components
*   **Balance Display Panel**: Standard card containing large typography showing active earnings.
*   **Disburse Form**: Prefilled with the rider's MoMo number and network from registration.
*   **Instant Cashout Button**: High-contrast bottom CTA.

#### User Flow
*   Rider clicks "Request Cashout" → Dialog prompts for payout OTP validation code (sent via SMS) → Confirms code → Payout transitions to `PENDING` waiting for backend release, and local balance locks.
