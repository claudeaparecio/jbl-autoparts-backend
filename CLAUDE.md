# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Run dev server with nodemon (port 4000)
docker compose up -d  # Start local MongoDB instance
```

There is no test suite (`npm test` is a placeholder).

## Environment Setup

Create a `config.env` file in the project root (not `.env`):

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname
SECRET_JWT=<long-random-string>
JWT_EXPIRES_IN=1d
JWT_COOKIE_EXPIRES_IN=1
```

The Docker Compose file spins up a local MongoDB on port 27017 (admin/admin123). For local dev, use `mongodb://admin:admin123@localhost:27017/yourdb?authSource=admin`.

## Architecture

**Entry points:**
- [src/server.js](src/server.js) — connects Mongoose, starts HTTP listener on port 4000
- [src/app.js](src/app.js) — Express app, middleware, route mounting

**Route → Controller mapping** (all under `/api/v1/`):
- `users` → [src/controllers/user/userControllers.js](src/controllers/user/userControllers.js)
- `products` → [src/controllers/products/productsController.js](src/controllers/products/productsController.js)
- `skus` → [src/controllers/skus/skusController.js](src/controllers/skus/skusController.js)
- `transactions` → [src/controllers/transaction/transactionsController.js](src/controllers/transaction/transactionsController.js)
- `/initialize` → [src/controllers/setup/setupContoller.js](src/controllers/setup/setupContoller.js)

## Key Domain Concepts

### Auth & Sessions
JWT tokens are validated against a live `sessions` collection (not just signature verification). Every login creates a `Session` document with `isActive: true`; logout sets it to `false`. Both checks must pass for a request to be authorized. Two middleware guards:
- `authGuard` — any recognized role
- `adminAuthGuard` — `admin` role only; also attaches `req.user._id` and `req.user.username`

Roles are defined in [src/utils/roles.js](src/utils/roles.js): `['admin', 'cashier', 'partsman', 'custom']`.

### SKU System
SKUs are stored as a normalized chain of chunks. A `SKUChunk` holds one segment (e.g. `"ABC"`) at a given `order` index. A `SKU` document holds an array of `SKUChunk` ObjectIds. A `Product` references one `SKU`.

When reading, chunks are joined with `"-"` in order to reconstruct the display string (e.g. `"ABC-123-XY"`). When writing, the SKU string is split on `"-"`, each part is upserted as a `SKUChunk` by `(chunk, order)`, then matched or created as a `SKU` by exact chunk array.

### Product Status
Status is computed from stock levels — never set freely:
- `available`: `quantityRemaining > quantityThreshold`
- `low_in_stock`: `quantityRemaining <= quantityThreshold`
- `out_of_stock`: `quantityRemaining === 0`

Products support variants via `parentId` (self-referencing ObjectId). Soft-delete via `is_deleted: true`.

### Transaction Lifecycle
State machine: `reserved → completed | cancelled`. `returned` is a terminal state only reachable from `completed`.

Stock is **deducted at reservation time** (not at completion). Cancel and return both restore stock. All stock mutations and status updates inside a transaction use **MongoDB sessions** for atomicity — always use `session` option when updating products inside these flows.

Invoice IDs are generated from the last 6 hex chars of the transaction ObjectId (see [src/helpers/services.js](src/helpers/services.js)).

### Image Uploads
Multer uses `memoryStorage()` — files are never written to disk. Buffers are streamed directly to Cloudinary via [src/utils/uploadToCloudinary.js](src/utils/uploadToCloudinary.js). The `existingImages` body field (JSON string) carries URLs for images that should be kept from a previous upload.

## Error Handling Pattern

Controllers use one of two patterns:
1. `try/catch` with `next(error)` — caught by the global error handler in [src/controllers/errorController.js](src/controllers/errorController.js)
2. `try/catch` returning `res.status(500).json(...)` directly

Throw operational errors using `new AppError(message, statusCode)` from [src/utils/AppError.js](src/utils/AppError.js). Async route handlers that use `next` should be wrapped with `catchAsync` from [src/utils/catchAsync.js](src/utils/catchAsync.js).

## Deployment

Deployed to Vercel (see [vercel.json](vercel.json)) — all routes rewrite to `src/server.js`. The Cloudinary credentials in [src/utils/cloudinary.js](src/utils/cloudinary.js) are currently hard-coded rather than read from env.
