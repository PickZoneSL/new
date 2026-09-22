# PickZoneSL

This project keeps the existing PickZone Main Site and PickZone Admin Panel UI and adds a PostgreSQL backend for the core shopping flow.

## Run
1. Create/use a PostgreSQL database. The app does not create a second database; it connects to the database in `DATABASE_URL` and creates only the required tables if missing.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (the supplied defaults are the requested initial admin).
3. Run `npm install`.
4. Run `npm start`.
5. Customer site: `/` or `/PickZone Main Site.html`. Admin: `/admin` or `/PickZone Admin.html`.

The first startup seeds the supplied 2,607-product catalog only when the `products` table is empty, and creates the initial admin account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## Core database tables
`admins`, `products`, `categories`, `customers`, `cart`, `cart_items`, `orders`, `order_items`.

## Security
Passwords are stored as bcrypt hashes. Authentication uses an HttpOnly, SameSite cookie carrying a signed JWT. Database credentials are server-side only.

## Scope
Implemented only the requested basic real-database core: admin auth, product CRUD/stock/category, customer auth/profile, persistent cart, transactional checkout/stock reduction, and admin order status updates.

## End-to-end smoke test
With PostgreSQL configured and the app running in another terminal, run `node scripts/smoke-test.js`. The test creates a temporary product/customer, exercises admin login → product creation → customer login → cart add/quantity change → checkout → stock reduction → admin status change → customer status read, then removes the temporary records.
