# Pengo achievements v2 — Endfield draft

Status: **disabled and unpublished**.

This draft exists to make the Endfield multi-state model testable before any
real account import is accepted. The live tracker, importer registry, runtime
publisher, and desktop launcher must continue to reject or hide Endfield
achievement import until real-account payloads prove these meanings.

## Envelope

- `kind`: exactly `pengo-achievements`
- `version`: exactly `2`
- `game`: exactly `ae`
- `catalogVersion`: non-empty pinned catalog identifier
- `exportedAt`: valid date-time
- `accountBinding`: optional existing `pengo-install-hmac-v1` binding
- `achievements`: unique rows sorted by stable string ID

Each achievement row has only `id` and `state`. A state has:

- `level`: whole number from zero through the catalog maximum
- `plated`: boolean; `true` only when the catalog permits plating
- `rareEffect`: boolean; `true` only when the catalog permits it
- `conditions`: unique rows sorted by stable condition ID

Each condition has only `id`, `current`, and `target`. Both numbers are
non-negative whole numbers, `current` cannot exceed `target`, and a known
condition target must exactly match the pinned catalog.

## Merge

- Never lowers any known progress.
- Uses the higher level.
- Keeps plating or a rare effect once either source reports it.
- Uses the higher current value for the same condition.
- Stops on conflicting targets.
- Preserves unknown achievement and condition IDs.

## Replace

- Uses the supplied state exactly for known achievements.
- Reports known achievements that would be removed.
- Retains unknown achievement IDs separately so a newer catalog can reconcile
  them later.
- Requires an explicit caller confirmation before any future storage write.

The fixture is synthetic. It proves validation and merge behavior only; it
does not claim the official game exports these fields in this shape.
