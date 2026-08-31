# Nyx — saved stopping point

Saved: 2026-08-31, 09:26 CEST / 07:26 UTC.

Stopped because My HoYo's Phase 15 website support needs deployment approval. The goal is blocked, not finished.

- Launcher work is saved and pushed at `697a6ae86ddf95e19dd135b5501c168f46d61828`. Local launcher/exporter checks and hosted run `33366146520` passed.
- Reviewed Site code is saved at `c265288f89662f400a425e47f18b8a4becad89ce`; the reviewed plan/tracker checkpoint is `d3af53d680658d0d1083e8d2713a251a1a243ece`. This note and the blocked status are saved afterward.
- Public launcher `v1.7` and the website are unchanged. New manual sync and gear exports are not enabled. Other evidence gaps and the seven inherited Site test failures remain recorded in the tracker.
- To resume, reply `AUTHORIZE: Deploy Phase 15 receiver`. No login or game launch is needed yet. Re-fetch, refresh the expired feeds, rebuild and verify the receiver before deployment; then prepare the private launcher check. Launcher publication needs separate approval.
- The later hands-on checks are grouped in the [execution tracker](nyx-launcher-endfield-hoyolab-execution-tracker-2026-08-24.md#next---hsr-manual-sync-in-one-sitting-after-receiver-approval).

For this stop only, the user requested one normal shutdown after saving. The one-shot instruction is consumed at this stopping point and must not be replayed automatically on resume. The request uses `shutdown.exe /s /t 0`, without `/f`; unsaved apps may block it. Do not force or retry. No permanent or recurring rule is created, and this note does not claim the PC has finished shutting down.
