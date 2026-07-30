# Warehouse Management Application — Technical Specification

This is the single source of truth for what to build. Story IDs (e.g. US-INB-02) are stable references.

---

## 1. Domain glossary

- **Asset / device:** a single piece of hardware (laptop, monitor, peripheral) tracked by serial number.
- **Client:** a customer of the warehouse (e.g. Esevel). Owns assets; receives invoices.
- **End user:** the person at the client's organisation to whom a device is deployed.
- **GRN:** Goods Received Note — the document acknowledging receipt of a delivery.
- **Event:** a recorded action against a device or client; if priced, it posts to the ledger.
- **Ledger:** the immutable, append-only record of every priced action (`events_ledger` table).
- **Bundle:** a single charge that replaces multiple component charges (e.g. Full Prep, Retrieval+Redeployment).
- **Commitment:** the monthly minimum amount a client is contractually billed (e.g. Esevel: ₹42,750).
- **SLA:** Service Level Agreement target (e.g. deployment within 1 business day).

---

## 2. Core principles

1. **One device, one timeline.** Every action against a device is on the device's profile, chronologically.
2. **One action, one ledger entry.** Every priced action posts exactly one ledger row at the moment the action completes.
3. **The ledger is immutable.** Corrections are new rows, never updates or deletes.
4. **Bundles suppress components.** When a bundle is applied, the component charges still get posted but flagged `suppressed = true`, with `suppressed_by_event_id` pointing to the bundle event.
5. **Multi-tenancy is enforced server-side.** Every business-data query filters by `client_id`. UI hiding is not enough.
6. **Rate card history is preserved.** Editing a rate creates a new version; events always use the rate effective at their `occurred_at`.

---

## 3. User roles

| Role | Description |
|------|-------------|
| `operator` | Warehouse floor staff. Receives, inspects, picks, packs, dispatches. |
| `manager` | Oversees operations, SLAs. Approves disposals (Phase 4). Sees all clients. |
| `admin` | Full access. Manages users, clients, rate card. |
| `client_user` | External user (e.g. Esevel staff). Sees only their own client's data. Read-mostly in Phase 1. |

---

## 4. Data model (Phase 1 entities)

All tables include standard audit columns (`id`, `created_at`, `updated_at`) unless noted. Monetary fields are stored in **paise as integers**.

### `clients`
- `client_id` (PK), `name`, `gstin`, `billing_address` (json), `registered_address` (json)
- `contact_name`, `contact_email`, `contact_phone`
- `committed_monthly_amount_paise` (bigint, default 4275000)
- `contract_start_date`, `contract_end_date`
- `status` (`active` | `inactive`)

### `users`
- `user_id` (PK), `email` (unique, case-insensitive), `password_hash`, `full_name`, `phone`
- `role` (`operator` | `manager` | `admin` | `client_user`)
- `client_id` (FK, nullable; required when role = `client_user`)
- `status` (`active` | `suspended`), `last_login_at`, `failed_login_count`, `locked_until`
- `totp_secret` (nullable, encrypted)

### `end_users`
- `end_user_id` (PK), `client_id` (FK), `name`, `email`, `phone`
- `default_shipping_address` (json), `notes`

### `locations`
- `location_id` (PK), `zone_code`, `bin_code`, `description`, `capacity` (nullable)
- Unique constraint on (`zone_code`, `bin_code`).

### `assets`
- `asset_id` (PK), `serial_number` (unique), `asset_tag` (nullable, unique when present)
- `model`, `manufacturer`, `category` (`laptop` | `monitor` | `peripheral`)
- `client_id` (FK)
- `current_status` (`in_stock` | `deployed` | `in_transit_out` | `in_transit_in` | `in_repair` | `awaiting_disposal` | `disposed`)
- `current_location_id` (FK, nullable when not in stock)
- `current_end_user_id` (FK, nullable; set when deployed — Phase 2)
- `condition_grade` (`A` | `B` | `C` | `damaged` | `unknown`)
- `acquisition_date`, `decommission_date` (nullable)

### `expected_deliveries`
- `delivery_id` (PK), `client_id` (FK), `supplier_name`, `po_number` (nullable), `expected_date`
- `status` (`expected` | `partial` | `received` | `cancelled`), `notes`

### `expected_delivery_items`
- `item_id` (PK), `delivery_id` (FK), `model`, `category`, `quantity_expected`, `quantity_received` (default 0)

### `goods_received_notes`
- `grn_id` (PK), `grn_number` (auto, format `GRN-YYYYMM-NNNN`)
- `delivery_id` (FK), `received_at`, `received_by` (FK users), `pdf_url` (nullable until generated)

### `grn_assets`
- Join table: `grn_id` (FK), `asset_id` (FK). Each GRN links to the assets created at that receipt.

### `inspections`
- `inspection_id` (PK), `asset_id` (FK), `type` (`intake` | `return`)
- `inspector_id` (FK users), `started_at`, `completed_at` (nullable)
- `cosmetic_grade` (`A` | `B` | `C` | `damaged`), `screen_check_pass` (bool), `power_on_pass` (bool), `accessories_complete` (bool)
- `notes`, `report_pdf_url` (nullable until generated)
- `sla_target_at`, `sla_completed_at` (nullable)

### `inspection_photos`
- `photo_id` (PK), `inspection_id` (FK), `s3_key`, `content_type`, `file_size`, `taken_at`

### `rate_card_items`
- `rate_item_id` (PK), `code` (unique within effective period, e.g. `INGEST_LAPTOP`), `description`
- `basis` (`per_device` | `per_peripheral` | `per_shipment` | `monthly_per_device` | `per_label`)
- `category_applies` (`laptop` | `monitor` | `peripheral` | `any` | `n/a`)
- `unit_rate_paise` (bigint)
- `effective_from`, `effective_to` (nullable; null means current)
- `is_bundle` (bool), `bundle_component_codes` (json string array; populated when `is_bundle = true`)

### `events_ledger` (append-only)
- `event_id` (PK), `asset_id` (FK, nullable for non-asset events like monthly storage rollups)
- `client_id` (FK), `rate_item_id` (FK), `event_type` (e.g. `INGEST`, `INSPECT`, `STORAGE_MONTHLY`)
- `occurred_at`, `quantity` (default 1), `unit_rate_paise` (snapshot of rate at occurred_at), `total_amount_paise`
- `source_module` (text), `source_ref_id` (text — e.g. the GRN id or inspection id that triggered this)
- `suppressed` (bool, default false), `suppressed_by_event_id` (FK, nullable)
- `correction_of_event_id` (FK, nullable; non-null when this row is a compensating correction)
- `created_at`, `created_by` (immutable; row never updated)

### `audit_log`
- `log_id` (PK), `user_id` (FK), `action`, `entity`, `entity_id`
- `old_value` (json, nullable), `new_value` (json, nullable), `occurred_at`, `ip_address`

### `holidays`
- `holiday_id` (PK), `date`, `name`. Used for business-hour SLA calculations.

---

## 5. Phase 1 user stories

### 5.1 Authentication & users

**US-AUTH-01 — Log in with email and password**
- Login form accepts email (case-insensitive) and password.
- Wrong credentials → generic error ("Invalid credentials"). Do not reveal which field is wrong.
- 5 failed attempts in 15 min → lock account for 30 min (set `locked_until`).
- Successful login → role-appropriate landing (operator: today's queue; manager: ops dashboard; admin: admin home; client_user: own inventory).
- Session expires after 12 hours of inactivity.

**US-AUTH-02 — Optional TOTP 2FA**
- Admin can toggle `2fa_required` on any user.
- User prompted at next login to enrol via QR code.
- Recovery codes (10) generated and shown once at enrolment.

**US-USR-01 — Manage users**
- Admin can create, edit, suspend, reactivate users.
- Email unique (case-insensitive); duplicate rejected with clear message.
- Role and (if `client_user`) `client_id` required.
- Suspended users cannot log in; history preserved.
- All changes audit-logged.

### 5.2 Clients & master data

**US-CLI-01 — Manage clients**
- Admin can create and edit clients.
- GSTIN validated against the standard 15-character pattern.
- Committed monthly amount defaults to 42,750 INR (4,275,000 paise) but is editable per client.
- All changes audit-logged.

**US-LOC-01 — Manage warehouse locations**
- Admin can create and edit locations identified by (`zone_code`, `bin_code`).
- Cannot delete a location currently holding assets.

**US-END-01 — Manage end users (per client)**
- Operator/manager/admin can create and edit end users.
- End user belongs to one client; the form scopes the client picker by the current user's permissions.
- Email/phone optional; name required.

### 5.3 Rate card

**US-RC-01 — Manage rate card with versioning**
- Admin can view, create, and "edit" rate items. Edits create a new version (new `effective_from`), never updates.
- Each rate item: code, description, basis, unit rate (in paise), category, `effective_from`, `effective_to`.
- Events posted before a rate change use the rate effective at their `occurred_at`.
- Bundles flagged `is_bundle = true` with the list of component codes they suppress.
- All changes audit-logged.

### 5.4 Inbound / Receiving

**US-INB-01 — Create expected delivery**
- Mandatory: client, supplier, expected date, at least one line item (model + category + quantity).
- Starts in `expected` status.

**US-INB-02 — Receive devices against expected delivery**
- Serial input is **scan-first** (focused input that accepts barcode scanner keystrokes).
- For each received device: capture serial (unique check — warn on duplicate, block without override), asset tag (optional), model, category.
- Each device → creates asset record with `current_status = in_stock` and posts an `INGEST` event to the ledger using the rate appropriate for its category at `occurred_at = now()`.
- Expected delivery status → `partial` after first receipt, `received` when all lines fully received.
- Discrepancies (short, damaged, unexpected) recorded as notes against the GRN.

**US-INB-03 — Generate GRN PDF**
- PDF generated server-side in a BullMQ background job.
- `grn_number` format: `GRN-YYYYMM-NNNN`, sequential within month, allocated atomically.
- Stored in S3; downloadable at any time.
- Contents: client, supplier, date, GRN number, list of devices with serials and tags, receiver name, signature line.

**US-INB-04 — Inspection-required flag**
- For each received device, operator marks "inspection required" or "exempt (sealed box)".
- Inspection required → auto-create inspection record with `status = pending` and `sla_target_at = +24h business-hours`.
- Exempt → no inspection event posted, only the ingestion event.

### 5.5 Inspection / QC

**US-INS-01 — Perform inspection (guided checklist)**
- Checklist: cosmetic grade (A/B/C/damaged), screen check pass (bool), power-on pass (bool), accessories complete (bool), notes.
- At least one photo required before completion.
- On completion: post `INSPECT` event to ledger; update asset's `condition_grade`.

**US-INS-02 — Capture photos**
- In-app camera capture (mobile/tablet) or file upload (desktop).
- Compress client-side to <1 MB each before upload.
- Stored in S3 with non-guessable keys; access requires authentication.
- Viewable from both the inspection record and the asset profile.

**US-INS-03 — Generate condition report PDF**
- Background job, available within 24h of inspection completion.
- Contents: device identifiers, inspection date, all checklist results, all photos, inspector name.
- Stored in S3, linked from inspection record.

### 5.6 Inventory

**US-INV-01 — Browse asset register**
- Filters: client, category, status, location, condition grade, age in current status.
- Search: serial, asset tag, model.
- Default sort: most recently updated first.
- Pagination at 50 rows; total count shown.

**US-INV-02 — Asset profile with full timeline**
- Header: serial, tag, model, category, current status, current location, condition grade, current owner.
- Timeline: all events from the ledger, reverse-chronological, with linked documents (GRN, inspection PDF, photos).

**US-INV-03 — Move asset between locations**
- Movement is a non-billable event in the ledger (audit trail only).
- Asset's `current_location_id` updates immediately.

**US-INV-04 — Ageing view of idle stock**
- Idle stock = assets with `current_status = in_stock`.
- Buckets: 0–7 days, 8–30, 31–60, 61–90, 90+.
- Filterable by client and category.
- Each row links to the asset profile.

### 5.7 Event ledger

**US-LEDG-01 — View ledger**
- Filters: client, date range, event type, asset.
- Read-only in UI.
- Default range: current calendar month.
- CSV export of filtered view.
- Running total at the foot.
- Suppressed entries shown greyed with a pointer to the bundle event that overrode them.

**US-LEDG-02 — Post manual correction**
- Admin-only.
- New ledger entry with negative quantity, referencing original `event_id` via `correction_of_event_id`.
- Reason text mandatory.
- Audit-logged.

### 5.8 Client portal (Phase 1 minimal read-only)

**US-PORT-01 — Client login & inventory view**
- A `client_user` logs in and sees only their own client's assets.
- Inventory page mirrors `US-INV-01` but client-scoped automatically and with no admin actions.

**US-PORT-02 — Client document access**
- Client can view and download their own GRNs and condition reports.
- Strict scoping: any direct URL access to another client's documents returns 404.

### 5.9 Retrieve & Redeploy (Repair / Resale / Disposal)

Built ahead of the original spec to support Esevel's retrieve-and-redeploy workflow; the
stories below capture the requirements clarified with Esevel via email
(2026-07-28) and confirmed by Divya.

**US-RTRV-01 — Diagnostic inspection on retrieval (mandatory)**
- Every retrieval creates a diagnostic inspection record; this cannot be skipped or
  made conditional. Esevel needs the diagnostic report to share with the client on
  every retrieval, regardless of whether a data wipe is required.

**US-RTRV-02 — Data wipe (optional per client)**
- Data wipe is not mandatory for every retrieval. Esevel confirms with the end
  client, per retrieval, whether a wipe is required, and selects it explicitly
  on the retrieval/disposal request. No auto-wipe and no forced skip.

**US-REP-01 — Repair SLA target**
- A repair request gets a target completion date (`slaTargetAt`), computed as
  5 business days (Mon–Fri 09:00–18:00 IST, excluding holidays) from the
  request's creation, unless the requester supplies a different estimate from
  the service center at creation time.

**US-REP-02 — Overdue repair tracking**
- Any repair request not yet `completed`/`cancelled` and past its
  `slaTargetAt` is flagged `isOverdue` wherever repair requests are listed, so
  staff can see at a glance which repairs have missed their turnaround target.
- Out of scope for this iteration: email/push alerts (no notification
  infrastructure exists yet), shipping/courier cost tracking to and from the
  service center, and billing for the actual repair cost (only the estimate
  and flat coordination fee exist today).

**US-RES-01 — Asset status synced on resale sale**
- When a resale listing is marked `sold`, the underlying asset's
  `current_status` moves to `sold` (a new terminal `AssetStatus` value), so
  the asset no longer appears in views that filter by asset status rather
  than resale-listing status.

**US-DISP-01 — ITAD certification add-on**
- Certification is selected directly on the disposal request. Included at no
  extra charge when the disposal type is a certified wipe (Blanco); for other
  disposal types, opting in adds a certification line item priced via the
  rate card.

---

## 6. Business logic specifications

### 6.1 Event posting
- Every priced action posts exactly one ledger row at the moment the action is recorded complete.
- Ledger row stores the rate effective at `occurred_at`, snapshotted into `unit_rate_paise`.
- Ledger rows are immutable. Corrections are new rows.

### 6.2 Bundle suppression
- When a bundled rate is applied: post the bundle event with the bundle's rate, then post each component event with `suppressed = true` and `suppressed_by_event_id` pointing to the bundle event.
- Suppressed entries are excluded from billing totals but remain visible in the ledger.
- If the bundle is reversed (correction), the `suppressed` flag on components is cleared.

### 6.3 Storage accrual (Phase 3 — specified for forward planning)
- Scheduled job on 1st of month at 02:00 IST.
- For each asset in stock at any point in the prior month, compute days-in-stock during that month.
- `charge = days_in_stock × (monthly_rate / days_in_month)`, rounded to nearest paisa.
- Monthly rate: 11,400 paise (laptops/monitors), 2,800 paise (peripherals).
- One `STORAGE_MONTHLY` event per asset per month.

### 6.4 Commitment reconciliation (Phase 3)
- For each client at month end:
  - `activity_total` = sum of non-suppressed, non-storage ledger entries.
  - `storage_total` = sum of `STORAGE_MONTHLY` events.
  - `billed = max(activity_total + storage_total, committed_monthly_amount)`.
  - If commitment binds, post one `COMMITMENT_ADJUSTMENT` event for the difference.

> **OPEN DECISION:** confirm whether commitment is a floor (default above) or a pre-paid credit consumed by activity. Affects Phase 3.

### 6.5 SLA timers
- Business hours: Mon–Fri, 09:00–18:00 IST. Exclude holidays from `holidays` table.
- Statuses: `on_track` (>20% time remaining), `at_risk` (5–20%), `breached` (≤0%).
- Phase 1: surface in inspection list. Phase 3: full SLA dashboard.

### 6.6 Multi-tenancy enforcement
- Every query that returns business data filters by `client_id`.
- Internal users (operator, manager, admin) can see all clients.
- `client_user` can only see records where `client_id` matches their assignment.
- Enforce in a request-scoped guard or Prisma middleware; the UI must not be the only barrier.

---

## 7. Non-functional requirements (summary)

- **Performance:** p95 read API <400ms, write <800ms. Page interactive <2s on 4 Mbps. 20 concurrent operators, scaling to 100.
- **Security:** HTTPS only, HSTS, Argon2id passwords, server-side authorisation on every endpoint, parameterised SQL only, file uploads validated.
- **Data retention:** daily DB backups (30-day rolling), monthly snapshots (12 months), photos/PDFs for contract+2y.
- **Browsers:** latest 2 versions of Chrome, Edge, Safari (iPad), Android Chrome.
- **i18n:** English only, INR only (₹ with Indian thousands grouping), Asia/Kolkata.

---

## 8. Phase plan

| Phase | Theme | Scope |
|-------|-------|-------|
| 1 (current) | Foundation | Auth, clients, master data, rate card, Inbound, Inspection, Inventory, Ledger, minimal client portal view |
| 2 | Movement | Deployment, Retrieval, Shipping (manual tracking entry), bundles for Full Prep and Retrieval+Redeployment |
| 3 | Billing & SLA | Billing engine, storage accrual, commitment reconciliation, Zoho Books push, SLA dashboard |
| 4 | Client & ITAD | Full client portal (request forms), Disposal/ITAD with certificates, audit reports, optional courier API |

---

## 9. Open decisions

| Decision | Detail |
|----------|--------|
| Commitment netting | Floor vs pre-paid credit. Default assumed: floor. Confirm before Phase 3. |
| Client portal in P1 | Minimal read-only view is in P1; raise-request forms are P4. |
| Courier API | Manual tracking-number entry through P3; optional one-carrier integration in P4. |
