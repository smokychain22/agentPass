# User-directed cleanup and dynamic quotes

RepoDiet is a user-controlled repository cleanup and editing service.

## Canonical workflow

1. Repository inventory (pinned Git tree)
2. RepoDiet suggestions and/or Repository Explorer selection
3. User selects any tracked path or finding
4. User chooses a requested action
5. RepoDiet analyzes the exact requested scope
6. Deterministic transformation plan
7. Isolated preflight → exact patch preview
8. Validation plan
9. Dynamic signed quote (bound to plan hash)
10. Payment channel: Direct website **or** OKX.AI A2A marketplace
11. Isolated execution → verified pull request → receipt

## Separation of concerns

| Concept | Meaning |
|---------|---------|
| `selectedRepositoryPaths` | What the user selected |
| `selectedFindingIds` | Suggestion IDs selected |
| `requestedActions` | What the user asked for |
| `transformationPlans` | Analysis outcomes |
| `cleanupEligiblePlans` | Executable `PLAN_READY` plans only |
| `blockedPlans` | Everything else |

**Selection never equals eligibility.** Only a verified `TransformationPlan` with a real preflight patch may receive a payable quote.

## APIs

- `GET /api/repository/inventory?scanId=…` — tracked path inventory
- `POST /api/user-directed/analyze` — `RequestedAction` → plans
- `POST /api/user-directed/preview` — isolated preflight patch (no payment)
- `POST /api/user-directed/quote` — dynamic signed quote bound to plan hash

## Pricing

There is no universal 1.00 USDT price. Quotes are composed from base execution, path count, transformation complexity, and validation. OKX marketplace floors are labeled separately from calculated cleanup cost.

## Safety

- Runtime/config and generated paths stay fail-closed for automatic deletion
- Custom user instructions produce bounded plans for review — never blind execution
- Client-modified prices, stale quotes, and plan-hash mismatches are rejected
