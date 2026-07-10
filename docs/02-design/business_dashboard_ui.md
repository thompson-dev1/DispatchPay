# DispatchPay Business Dashboard UI Specification

This document specifies the user interface design for the **DispatchPay Business Dashboard**, styling components and flows with a clean, low-clutter aesthetic inspired by Stripe, Linear, and Notion.

---

## Design System & Aesthetics (Stripe/Linear/Notion Inspired)
*   **Palette**: Dark mode primary, using monochromatic neutral grays (`#09090b` for background, `#18181b` for card panels, `#27272a` for borders/dividers) and high-contrast typography (`#f4f4f5` for body, `#fafafa` for headers, `#a1a1aa` for captions).
*   **Accents**: Indigo (`#6366f1`) for main call-to-actions, Emerald (`#10b981`) for positive balances/success states, Amber (`#f59e0b`) for pending/processing tasks.
*   **Borders**: Thin 1px solid borders, square or `rounded-md` (6px) corners. No heavy dropshadows; use subtle keyhole shadows or borders to indicate elevation.

---

## 1. Global Navigation Layout (Sidebar Wireframe)

Every page shares a global, responsive sidebar layout:

```
+-----------------------------------------------------------------------------+
| [D] DispatchPay | Wallet: GHS 10,500.00 [Fund] | User Profile (JD)          |
+-----------------------------------------------------------------------------+
| (•) Dashboard      |                                                        |
| [ ] Create Task    |                                                        |
| (o) Riders         |                     MAIN VIEWPORT                      |
| [x] History        |                                                        |
| {*} Settings       |                                                        |
+--------------------+--------------------------------------------------------+
```

---

## 2. Page Specifications

### Page A: Dashboard (Overview & Metrics)

#### Wireframe Mockup
```
+-----------------------------------------------------------------------------+
| Dashboard                                          [ + Create Delivery ]     |
|                                                                             |
| +------------------+  +------------------+  +------------------+            |
| | Active Trips: 12 |  | Available Riders |  | Today's Earnings |            |
| | [============]   |  | 8 / 12 Online    |  | GHS 1,450.00     |            |
| +------------------+  +------------------+  +------------------+            |
|                                                                             |
| Recent Deliveries                                                           |
| +-------------------------------------------------------------------------+ |
| | Tracking   | Destination     | Rider           | Status    | Amount     | |
| |------------+-----------------+-----------------+-----------+------------| |
| | DP-1092-A  | Airport Res.    | Kwame Mensah    | Transit   | GHS 50.00  | |
| | DP-1091-B  | Cantonments     | Yaw Boateng     | Delivered | GHS 45.00  | |
| +-------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------+
```

#### Core Components
*   **KPI Metric Cards**: Compact containers with large font weights for numbers, accompanied by micro-percentage growth indicators.
*   **Live Activities Table**: Structured grid displaying recent deliveries with status indicators (colored dots: green for delivered, yellow for in transit, gray for pending).
*   **Quick Action Button**: Top right primary button to navigate to "Create Delivery".

#### User Flow
*   Admin logs in → Lands on Dashboard → Scans active operations → Clicks "Fund" to add capital or clicks "Create Delivery" to spawn a new delivery request.

#### UI States
*   **Loading State**: Skeleton cards with pulsing gray shapes replacing text and numbers; table rows show loading gradients.
*   **Empty State**: When no deliveries exist, a clean center container appears: a simple illustration of a delivery box, a "No active deliveries" caption, and a prominent "+ Create Delivery" button.
*   **Error State**: A banner appears at the top: `[!] Connection lost. Re-attempting sync...` using a red warning style.

---

### Page B: Create Delivery Form

#### Wireframe Mockup
```
+-----------------------------------------------------------------------------+
| Create Delivery                                                             |
|                                                                             |
| [Form Inputs]                         [Map Preview]                         |
| Pickup Address:                       +-----------------------------------+ |
| [ 12 Ring Road Central, Accra     ]   |                                   | |
| Destination Address:                  |            Accra Map              | |
| [ Cantonments, Accra              ]   |                                   | |
| Customer Details:                     |  (Pickup) ----------- (Dropoff)   | |
| Name: [ Joe Mensah ]                  |                                   | |
| Phone: [ +233240000000 ]              +-----------------------------------+ |
|                                       Financial Splits:                     |
| Pricing Splits:                       Customer Fee: GHS 50.00               |
| Fee: [ 50.00 ]  Commission: [ 10.00 ]  Rider Payout: GHS 40.00               |
|                                                                             |
| Rider Assignment: [ Kwame Mensah (Available) v ]                            |
|                                                                             |
| [ Clear ]                                                 [ Dispatched > ]  |
+-----------------------------------------------------------------------------+
```

#### Core Components
*   **Split Pane Form Layout**: Left pane contains address, customer, pricing, and rider inputs; right pane displays the route map.
*   **Rider Select Dropdown**: Styled with status badges (Online/Busy/Offline) for each rider.
*   **Financial Summary Card**: Auto-calculates splits: $\text{Rider Payout} = \text{Fee} - \text{Commission}$.

#### Validation Rules (Zod Schema on Blur)
*   `pickupAddress` / `deliveryAddress`: Required, minimum 5 characters.
*   `customerPhone`: Valid E.164 phone number.
*   `feeAmount`: Must be a positive decimal; `commissionAmount` cannot exceed `feeAmount`.

#### UI States
*   **Loading State**: Input fields are locked; select dropdown displays a spinning loader wheel.
*   **Validation Error State**: Form borders turn red with micro-text errors displaying underneath: `* Phone number format incorrect`.
*   **Submission Success State**: Form elements slide left; a success checkmark animation renders, indicating: `Delivery DP-2026-X92 created and dispatched to Rider Kwame Mensah.`

---

### Page C: Riders Directory

#### Wireframe Mockup
```
+-----------------------------------------------------------------------------+
| Riders Directory                                   [ + Provision Rider ]    |
|                                                                             |
| [ Search riders... ] [ Filter: All v ]                                      |
|                                                                             |
| +-------------------------------------------------------------------------+ |
| | Rider Name     | Vehicle   | Status       | Active Trips | Wallet Bal.  | |
| |----------------+-----------+--------------+--------------+--------------| |
| | Kwame Mensah   | Moto      | [•] Active   | 2            | GHS 340.00   | |
| | Yaw Boateng    | Moto      | [•] Busy     | 1            | GHS 120.00   | |
| | Ama Serwaa     | Van       | [ ] Offline  | 0            | GHS 0.00     | |
| +-------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------+
```

#### Core Components
*   **Search & Filter Bar**: Free-text query input alongside a status dropdown selector.
*   **Interactive Data Grid**: Row actions allow editing profile details, viewing ledger history, or initiating manual payout overrides.

#### User Flow
*   Admin clicks "Riders" → Searches for a rider (e.g., "Kwame") → Click row → Drawer slides from the right containing the Rider profile, vehicle registration details, and mobile wallet number.

#### UI States
*   **Empty State**: "No riders match your query." Displays a clear filter action.
*   **Loading State**: Grid rows display placeholder lines with a shimmer animation.

---

### Page D: Delivery Details

#### Wireframe Mockup
```
+-----------------------------------------------------------------------------+
| Delivery Details: DP-1092-A                           [ Assign Rider v ]    |
|                                                                             |
| +----------------------------------+  Timeline Logs                         |
| | Pickup: 12 Ring Road             |  [ ] Picked Up (12:50 PM)              |
| | Dropoff: Airport Residential     |  [x] Assigned (12:46 PM) - Kwame M.    |
| | Distance: 6.2 km                 |  [x] Created (12:45 PM)                |
| +----------------------------------+                                        |
|                                       Split Audit Log                       |
| Map View                              Customer Paid:  GHS 50.00             |
| +----------------------------------+  Rider Earned:   GHS 40.00             |
| | (Pickup) -------[R]----- (Drop)  |  Commission:     GHS 10.00             |
| +----------------------------------+                                        |
+-----------------------------------------------------------------------------+
```

#### Core Components
*   **Operational Timeline**: Vertical progress stepper detailing delivery timestamps (Created → Assigned → Picked Up → Delivered).
*   **Live Route Tracker**: Renders coordinates using mapping libraries, plotting the active rider (`[R]`) location dynamically.
*   **Split Ledger Panel**: Side-by-side audit overview of fees, commissions, and payout ledger entries.

#### UI States
*   **Loading State**: Timeline entries show pulsing grey bars; map container displays a loading spinner.
*   **Error State**: If GPS connection drops: `[!] GPS Tracking Offline. Rider last seen 4 mins ago.` using an amber warning alert.

---

### Page E: Delivery History (Audit logs)

#### Wireframe Mockup
```
+-----------------------------------------------------------------------------+
| Delivery History                                            [ Export CSV ]  |
|                                                                             |
| [ Date: Last 30 Days v ] [ Status: All v ] [ Search tracking #... ]         |
|                                                                             |
| +-------------------------------------------------------------------------+ |
| | Date       | Tracking ID | Destination    | Fee       | Payout    | Stat  | |
| |------------+-------------+----------------+-----------+-----------+-------| |
| | 2026-07-09 | DP-1082     | East Legon     | GHS 60.00 | GHS 48.00 | OK    | |
| | 2026-07-08 | DP-1071     | Labone         | GHS 40.00 | GHS 32.00 | OK    | |
| +-------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------+
```

#### Core Components
*   **Calendar Date-Range Picker**: Linear-styled input drawer for date filtering.
*   **Export Component**: Outlined CTA button that requests a CSV payload download.

---

### Page F: Settings

#### Wireframe Mockup
```
+-----------------------------------------------------------------------------+
| Settings                                                                    |
|                                                                             |
| [ Profile ]  [ Wallet & Billing ]  [ Integrations ]  [ Security ]           |
|                                                                             |
| API Keys                                                                    |
| Use these keys to authenticate requests from your custom software.          |
|                                                                             |
| Production API Key:                                                         |
| [ dp_live_9281a************************* ]                     [ Reveal ]   |
|                                                                             |
| Moolre Webhook Callback URL:                                                |
| [ https://api.dispatchpay.com/api/v1/payments/webhook  ]       [ Copy ]     |
|                                                                             |
| [ Save Settings ]                                                           |
+-----------------------------------------------------------------------------+
```

#### Core Components
*   **Tabbed Navigation Header**: Monochromatic Notion-style tabs to switch contexts.
*   **API Key Manager**: Protected inputs with toggles to reveal or roll authentication keys.
