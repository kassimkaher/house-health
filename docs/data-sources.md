# Data Source & Licensing Registry

Every imported food record retains provenance (`food_source_records`:
provider, external ID, original payload, checksum) and every provider is
registered in `data_providers` with its license terms. This file is the
human-readable index of that table — keep it in sync when a new provider is
added via the admin API or a seed script.

| Provider key | Name | License | Attribution required | Notes |
|---|---|---|---|---|
| `iq_manual` | Internal Iraqi dataset (manually curated) | Internal | No | Hand-curated by the nutrition team; canonical source for Iraqi dialect names/aliases and local portions (e.g. samoon). |
| `usda_fdc` | USDA FoodData Central | CC0 1.0 (public domain) | No | Reference adapter prepared; not bulk-imported in this phase. https://fdc.nal.usda.gov/ |
| `openfoodfacts` | Open Food Facts | ODbL 1.0 | **Yes** — must credit Open Food Facts contributors wherever OFF-sourced data is displayed | Reference adapter prepared; not bulk-imported in this phase. https://world.openfoodfacts.org/ |

## Adding a new provider

1. Insert a `data_providers` row (`key`, `name`, `licenseName`, `licenseUrl`,
   `attributionRequired`, `licenseMeta`) — via a seed or an admin script; no
   dedicated CRUD endpoint exists for providers in this phase since the set
   changes rarely.
2. Add a row to the table above.
3. If `attributionRequired` is true, confirm the required attribution text
   is surfaced wherever the sourced data reaches an end user (mobile app
   food detail screens are the primary surface — tracked as a mobile-phase
   follow-up since no mobile client exists yet).

## Import file provenance guarantee

Every row processed by the import pipeline is checksummed
(`food_source_records.payloadChecksum`, sha256 of the raw row) and stamped
with `transformationVersion` (currently `normalizer@1`) so a future
normalizer change can be identified against historically imported data. The
original payload is retained in full (`originalPayload` JSONB) — nothing
from a source file is discarded, even fields the current schema doesn't map.

## Sample/fixture data

`packages/pipeline/test/fixtures/foods-sample.csv` is a small,
self-authored fixture (4 valid Iraqi foods + 1 intentionally invalid row for
error-path testing) used by integration tests and suitable as an import
template example (see `docs/import-template.md`). It is not sourced from any
external dataset and carries no license obligations.
