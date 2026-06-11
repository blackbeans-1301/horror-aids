This file provides guidance to AI coding Agent when working with code in this repository.

## Project Overview

EduCenter is a K12 tutoring center management SaaS for Vietnam. It covers class management, scheduling, attendance, student evaluations, learning reports, tuition calculation, and payroll. UI copy must be Vietnamese.

## Tech Stack

- **Framework:** Next.js 16 App Router (React 19)
- **Rendering:** Client-side rendering for dynamic data with TanStack Query. Keep Server Components thin — routing and layout only.
- **Database:** PostgreSQL on Supabase
- **ORM:** Drizzle ORM with `withTenantContext()` for all tenant queries
- **Auth:** Custom username/password JWT via `jose`, stored in `httpOnly` cookies
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix primitives)
- **State:** TanStack Query for server data; Zustand for client-only state
- **Validation:** Zod v4 — schemas live in `src/lib/validations/`
- **Dates:** `date-fns`; display as `DD-MM-YYYY`, store/transport as ISO `YYYY-MM-DD`
- **Testing:** Vitest (`pnpm test` / `pnpm test:watch`)

## Commands

```
pnpm run dev              # start dev server
pnpm run build            # production build
pnpm run lint             # ESLint
pnpm run test             # run tests (Vitest)
pnpm run test:watch       # watch mode
pnpm run db:generate      # generate Drizzle migration
pnpm run db:migrate       # apply migrations
pnpm run db:push          # push schema changes (dev only)
pnpm run db:check         # verify DB connection
pnpm run seed:superadmin  # seed platform super admin
```

Before handing off changes, run `pnpm lint` and `pnpm build`.

## Project Structure

```
src/
  app/
    (app)/
      login/            # center staff login
      superadmin/       # super admin workspace
      [centerId]/       # center workspace (dashboard, classes, students, subjects, settings)
    api/
      auth/             # login, refresh, logout, me
      center/           # center-scoped resource endpoints
      platform/         # super admin platform endpoints
  components/           # shared app components (sidebar, nav, page header)
  components/ui/        # shadcn/ui primitives — add new ones via the shadcn MCP
  features/             # feature modules: <feature>/api.ts with TanStack Query hooks + TS types
  hooks/                # shared React hooks
  lib/
    api/                # client.ts (ApiClient), routes.ts (API_ROUTES), response.ts helpers, types, errors
    auth/               # jwt.ts, middleware.ts (requireAuth/requireCenterAuth/requireSuperAdmin), context.ts
    db/                 # client.ts (Drizzle), schema.ts, context.ts (withTenantContext)
    validations/        # Zod schemas per domain
  proxy.ts              # Next.js middleware: JWT auth + RBAC + injects x-user-* headers
  services/             # business logic called by route handlers
  stores/               # Zustand stores
  types/                # shared TypeScript types (UserRole, AttendanceStatus, etc.)
drizzle/                # generated migrations
docs/Specification Documents/MVP/  # specs — read before implementing features
```

## Architecture: Auth & Request Flow

The auth system has two layers that work together:

1. **`src/proxy.ts` (Next.js middleware)** — runs on every `/api/center/*` and `/api/platform/*` request. It verifies the JWT from cookies, checks role-based policies from `CENTER_POLICIES`, and injects `x-user-id`, `x-user-role`, and `x-center-id` request headers.

2. **Route handlers** — use `getCenterId(request)` from `src/lib/auth/context.ts` to read the `x-center-id` header the proxy already set. They do **not** re-verify the JWT. The `requireCenterAuth()` / `requireAuth()` functions in `src/lib/auth/middleware.ts` are available but not used in the current route handlers — the proxy handles this.

New RBAC rules belong in `CENTER_POLICIES` inside `src/proxy.ts`.

## Architecture: Multi-tenancy

**Critical rule:** every tenant-scoped Drizzle query must filter by `centerId`. Use `withTenantContext(centerId, tx => ...)` from `src/lib/db/context.ts` — it wraps the query and enforces the tenant scope.

- `super_admin` users have `centerId = null`; all center staff have exactly one `centerId`
- JWT `centerId` is the **only** trusted source of tenant scope — never trust route params or request body for tenancy
- Every tenant-owned table has `center_id` indexed

## Architecture: Feature Modules

Client-side data fetching lives in `src/features/<feature>/api.ts`. Each file exports:

- TypeScript interfaces (payload and response shapes)
- TanStack Query hooks: `use<Resource>()` for queries, `useCreate<Resource>()` / `useUpdate<Resource>()` for mutations
- Mutations invalidate relevant query keys on success

Hooks import `api` from `src/lib/api/client.ts` and route constants from `src/lib/api/routes.ts` (`API_ROUTES`). Never inline fetch calls in components.

## Architecture: API Route Handlers

Pattern for center-scoped routes:

```ts
export async function POST(request: NextRequest) {
  const centerId = getCenterId(request); // from proxy-set headers
  // parse + validate with Zod
  const parsed = createXSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  // call service
  try {
    const result = await createX(centerId, parsed.data);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "X_NOT_FOUND")
      return notFound("...");
    return internalError();
  }
}
```

Response helpers are in `src/lib/api/response.ts`: `validationError`, `notFound`, `conflict`, `internalError`.

## Architecture: Services

Services contain all business logic. They:

- Accept `centerId` as first argument and validated input types from `src/lib/validations/`
- Use `withTenantContext(centerId, tx => ...)` for all DB queries
- Throw `Error` with a string code (e.g., `throw new Error("CLASS_NOT_FOUND")`) for domain errors — route handlers catch these and map them to HTTP responses

## Routing

- Login: `/login`
- Center workspace: `/[centerId]/[feature]` — e.g., `/[centerId]/attendance`
- Super admin: `/superadmin/[feature]`

## UI Rules

- Use shadcn/ui for every component: forms, tables, dialogs, navigation, controls, feedback, layout
- Add missing shadcn components via the shadcn MCP server; do not hand-roll primitives
- Tailwind CSS v4 for all styling

## Business Rules

- XLSX exports (reports, tuition, payroll) must be **client-side** with SheetJS — no server-side export endpoints
- Tuition and payroll are computed on demand from date ranges — do not persist calculated status for MVP
- Prefer soft deletes (`status = 'inactive'`) over hard deletes for business records

## Roles

`super_admin` | `admin` | `sub_admin` | `teacher` | `assistant` | `accountant`

`super_admin` has no `centerId`. All other roles belong to one center.
