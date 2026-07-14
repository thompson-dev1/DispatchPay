# DispatchPay Stacked PR Train

This is the canonical stacked workflow for the current branch train and two-dev collaboration.

## 1) Branch Strategy
- If a branch already exists on `origin`, do not recreate it.
- Move to the next phase (PR creation/rebasing/merge train).
- Keep branch lineage exactly in this order:
  - `feature/P1-01-monorepo-bootstrap`
  - `feature/P1-02-db-migration-baseline`
  - `feature/P2-01-auth-foundation`
  - `feature/P3-01-backend-ops-routes`
  - `feature/P4-01-payments-payouts`
  - `feature/P2-03-frontend-auth-client`

## 2) PR Base Mapping (for clean diffs)
- PR-1: `feature/P1-01-monorepo-bootstrap` -> `main`
- PR-2: `feature/P1-02-db-migration-baseline` -> `feature/P1-01-monorepo-bootstrap`
- PR-3: `feature/P2-01-auth-foundation` -> `feature/P1-02-db-migration-baseline`
- PR-4: `feature/P3-01-backend-ops-routes` -> `feature/P2-01-auth-foundation`
- PR-5: `feature/P4-01-payments-payouts` -> `feature/P3-01-backend-ops-routes`
- PR-6: `feature/P2-03-frontend-auth-client` -> `feature/P4-01-payments-payouts`

## 3) Merge Train Rules
- Merge strictly in order: PR-1 -> PR-2 -> PR-3 -> PR-4 -> PR-5 -> PR-6.
- Before merging each next PR, retarget its base to `main`.
- After each merge:
  - `git checkout main`
  - `git pull --rebase origin main`
  - `git branch -d <merged-branch>`
  - `git push origin --delete <merged-branch>`

## 4) Team Safety Rules (2 Devs)
- Never force-push to shared train branches unless both devs explicitly agree.
- Use one owner per PR branch to avoid accidental history rewrite.
- If conflicts occur, resolve them on the branch that is next to merge, not on `main`.

## 5) Repository Sanity Gate (run before PR and before merge)
- `npm ci`
- `npm run sanity`
- `git status -sb` must be clean before push/merge actions.

## 6) Final Validation
After the final merge:
- `git checkout main`
- `git pull --rebase origin main`
- `git log --oneline -n 15`

Expected outcome: modular commit flow, clean diffs, and reproducible merge sequence.
