# DispatchPay Frontend State Management Design

This document details the frontend state management architecture for the **DispatchPay Business Dashboard** and the **Rider PWA**. It outlines boundaries between local form inputs, global context parameters, and server-side cached state.

---

## 1. State Boundaries & Categorization

To maintain rendering performance and avoid state fragmentation, DispatchPay splits state into four functional boundaries:

```
+-------------------------------------------------------------------------------------------------+
|                                     FRONTEND STATE ARCHITECTURE                                 |
+-------------------------------------------------------------------------------------------------+
          │                              │                          │                       │
          ▼                              ▼                          ▼                       ▼
+───────────────────+          +───────────────────+      +───────────────────+   +───────────────────+
|   Server State    |          |   Global State    |      |    Form State     |   |    Auth State     |
+───────────────────+          +───────────────────+      +───────────────────+   +───────────────────+
| TanStack Query    |          | React Context     |      | React Hook Form   |   | React Context     |
|                   |          |                   |      |                   |   |                   |
| - Deliveries list |          | - Sidebar toggle  |      | - Delivery Form   |   | - Session profile |
| - Rider profiles  |          | - UI theme        |      | - Rider profile   |   | - Access Token    |
| - Ledger entries  |          | - Active filters  |      |   inputs          |   |   in-memory       |
+───────────────────+          +───────────────────+      +───────────────────+   +───────────────────+
```

---

## 2. State Management Strategies

### A. Server State — TanStack Query

All external database-driven resources are loaded, cached, and updated using **TanStack Query** (`@tanstack/react-query`). This abstracts loading/error flags and coordinates cache synchronization across the component tree.

#### Caching Strategy

| Resource | `staleTime` | `gcTime` | Rationale |
| :--- | :--- | :--- | :--- |
| Active Deliveries | 5 seconds | 5 minutes | Changes in near-real-time; must be fresh |
| Rider List | 30 seconds | 10 minutes | Changes less often but must feel live |
| Ledger Entries | 60 seconds | 30 minutes | Historical/append-only, safe to cache longer |
| Business Profile | 5 minutes | 1 hour | Rarely changes; aggressive caching is safe |
| Wallet Balance | 10 seconds | 5 minutes | Financial data; stale data is high-risk |

#### Cache Invalidation Strategy
Mutations explicitly call `queryClient.invalidateQueries` on success to pull fresh datasets:

```typescript
// apps/business-web/src/hooks/use-deliveries.ts

export const useAssignRider = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deliveryId, riderId }) => assignRiderApi(deliveryId, riderId),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery', variables.deliveryId] });
    },
  });
};
```

#### Optimistic Updates
For rapid UI feedback — critical on the Rider PWA under weak 3G connections — optimistic updates are applied on high-frequency state transitions:

```
[ Rider taps "Slide to Pick Up" ]
           │
           ▼
[ 1. cancelQueries(['delivery', id]) ]  ← Stop stale refetches from overwriting
           │
           ▼
[ 2. Snapshot previous cache state ]    ← Saved for rollback on failure
           │
           ▼
[ 3. setQueryData: status = PICKED_UP ] ← UI renders INSTANTLY (no spinner)
           │
           ▼
[ 4. POST /deliveries/:id/status ]      ← Network request fires in background
           │
     ┌─────┴───────┐
     ▼             ▼
  Success        Error
     │             │
     ▼             ▼
[ Refetch ]   [ Rollback snapshot ]
                   │
                   ▼
            [ Toast Error: "Connection failed. Please try again." ]
```

---

### B. Global State — React Context

Global state handles UI parameters and client-session preferences that do not require server synchronisation:

- **Use Cases**: Sidebar open/close state, toast notification queue, active filter values persisted across page navigation.
- **Decision — No Redux or Zustand**: Global context objects are kept minimal (< 5 values per context). Heavy state managers add complexity and bundle size for what is essentially a few boolean and string values.
- **Performance**: Contexts are split by domain (e.g., `SidebarContext`, `ThemeContext`) so a sidebar toggle does not re-render components subscribed only to `ThemeContext`.

---

### C. Form State — React Hook Form + Zod

Form management is handled by **React Hook Form**, integrated with **Zod** schema validation via the `@hookform/resolvers/zod` adapter.

- **Performance**: React Hook Form uses uncontrolled inputs. Field values are read once at validation time — not on every keystroke — eliminating the n-render problem on complex forms.
- **Schema Sharing**: Zod schemas from `packages/types/src/validation/` are imported directly by both the backend API and the frontend Hook Form resolvers — a **single source of truth** for validation rules.
- **Scope**: Form states are confined to the form component subtree and destroyed on unmount.

```typescript
// Shared schema in packages/types
export const createDeliverySchema = z.object({
  pickupAddress: z.string().min(5),
  deliveryAddress: z.string().min(5),
  feeAmountMinor: z.number().int().positive(),
  commissionAmountMinor: z.number().int().positive(),
  riderId: z.string().uuid().optional(),
});

// Consumed identically by both frontend and backend
const form = useForm<CreateDeliveryInput>({
  resolver: zodResolver(createDeliverySchema),
  defaultValues: { feeAmountMinor: 0, commissionAmountMinor: 0 },
});
```

---

### D. Authentication State — React Context + Axios Interceptors

- **Token storage separation**:
  - **Refresh Token**: `HttpOnly Secure SameSite=Strict` cookie. Inaccessible to JavaScript entirely.
  - **Access Token**: In-memory React Context only. Lost on page refresh intentionally — the app silently calls `/auth/refresh` on mount to restore it.
- **Silent refresh on mount**: A `useEffect` in `AuthProvider` fires a single silent request to `/auth/refresh`. If it succeeds, the access token populates in context. If `401`, redirect to login.
- **Axios 401 Interceptor**:

```
[ API Call: GET /deliveries ]
          │
          │ 200 OK  →  [ Return data ]
          │
          │ 401 Unauthorized
          ▼
[ Intercept 401 response ]
          │
[ POST /auth/refresh (using HttpOnly cookie) ]
          │
     ┌────┴──────┐
     ▼           ▼
  Success     Failure
     │           │
[ Update      [ Clear AuthContext ]
  context ]        │
     │         [ Redirect to /login ]
[ Replay original failed request ]
```

---

## 3. Query Key Naming Convention

| Key Pattern | Scope | Example usage |
| :--- | :--- | :--- |
| `['deliveries']` | All deliveries list | List page |
| `['delivery', id]` | Single delivery | Detail page |
| `['riders']` | All riders in tenant | Riders directory |
| `['rider', id]` | Single rider profile | Rider detail drawer |
| `['wallet', 'business']` | Business wallet | Dashboard wallet card |
| `['wallet', 'rider', id]` | Rider wallet | Rider earnings page |
| `['ledger', walletId]` | Ledger entries | Audit log tables |

---

## 4. Recommended Folder Structure

```
apps/business-web/src/
│
├── components/                    # Reusable, stateless presentation components
│   ├── ui/                        # Base design system: Button, Input, Badge, Dialog
│   ├── delivery/                  # Delivery-specific view blocks
│   ├── rider/                     # Rider card and drawer views
│   └── wallet/                    # Wallet summary and ledger display
│
├── context/                       # React Contexts (Global + Auth)
│   ├── auth.context.tsx           # Session state, token memory, silent refresh
│   └── ui.context.tsx             # Sidebar, theme, notifications queue
│
├── hooks/                         # Custom hooks encapsulating TanStack Query calls
│   ├── use-auth.ts                # Auth Context consumer with typed helpers
│   ├── use-deliveries.ts          # useDeliveries, useDelivery, useCreateDelivery
│   ├── use-riders.ts              # useRiders, useRider, useUpdateRider
│   ├── use-payouts.ts             # usePayouts, useRequestPayout
│   └── use-wallet.ts              # useBusinessWallet, useRiderWallet
│
├── services/                      # Network layer
│   └── api-client.ts              # Axios instance with baseURL, auth headers,
│                                  # and the 401 silent-refresh interceptor
│
├── pages/                         # Route-level page components
│   ├── login.tsx
│   ├── dashboard.tsx
│   ├── create-delivery.tsx
│   ├── delivery/
│   │   ├── [id].tsx               # Delivery Details page
│   │   └── history.tsx            # Delivery History page
│   ├── riders/
│   │   └── index.tsx              # Riders Directory
│   └── settings.tsx
│
├── App.tsx                        # QueryClientProvider + Router + AuthProvider
└── main.tsx                       # React DOM render entry
```

---

## 5. Query Client Global Configuration

```typescript
// apps/business-web/src/App.tsx

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30s default stale time
      retry: 2,                   // Retry failed queries twice
      refetchOnWindowFocus: true, // Refresh data when user tab-switches back
    },
    mutations: {
      retry: 0,                   // NEVER auto-retry mutations (financial safety)
    },
  },
});
```

> **Critical rule**: Mutations must never auto-retry. Retrying a failed mutation (e.g., `POST /payouts/request`) risks double-executing a financial transaction. Retries must always be explicitly triggered by the user via a visible button action.
