# Nyx — saved stopping point

Saved: 2026-08-31, 09:26 CEST / 07:26 UTC.

Historical stop: My HoYo's Phase 15 website support needed deployment approval. The goal was blocked, not finished. The user resumed and supplied `AUTHORIZE: Deploy Phase 15 receiver` later on 2026-08-31. That approval and deployment are now complete; the overall goal is not.

Resume update, 2026-08-31 15:20 CEST: the single [production run `33392750660`](https://github.com/Asyce/Nyx/actions/runs/33392750660) passed. Website/receiver `73ce188afcb927ac4363fad6bafb78a771c611ee` is live and verified, including My HoYo, 12 non-mutating API cases and exact feed/image hashes. Do not repeat the deployment or its approval.

- Launcher candidate `e7ea64807c7ffafbaf1494f51bff473d051f67db` is locally committed, with fresh tests and private development packaging underway. It changes only the existing manual-sync gate and matching test expectation after live proof. Prior base `697a6ae` and its hosted run `33366146520` remain verified history, not proof of the new candidate.
- Do not start/install the enabled candidate against real AppData. Finish exact package verification and the isolated synthetic native check first. Real HSR login, recovery, upload/deletion checks and publication remain separate.
- Public launcher `v1.7` is unchanged. Gear exports and automatic sync remain unavailable. Other evidence gaps and the seven inherited Site test failures remain recorded in the tracker.
- The later hands-on checks are grouped in the [execution tracker](nyx-launcher-endfield-hoyolab-execution-tracker-2026-08-24.md#next---hsr-manual-sync-in-one-sitting-after-receiver-approval).

For this stop only, the user requested one normal shutdown after saving. `shutdown.exe /s /t 0` was issued exactly once, without `/f`, and returned exit 0. The one-shot instruction is consumed and must not be replayed on resume. Unsaved apps may have blocked the shutdown; completion was not observed. Do not force or retry. No permanent or recurring rule was created.
