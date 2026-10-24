# Offline recovery (laptop asleep, switched off, or worker down)

RightNow sends only from a machine that is running. When it sleeps, is switched off or the worker is stopped, nothing
is sent and nothing is synced. This page says what happens when it comes back, what is rebuilt from the mailboxes and
what is lost. The behaviour is proven by `packages/core/test/e2e/downtime.test.ts` (1, 7 and 30 days, after a sleep
and after a cold boot).

## What happens on wake

1. **Nothing is sent before a fresh sync.** A mailbox sends only when its inbox sync finished within
   `SYNC_MAX_STALENESS_SEC` (default 300 s). After a downtime every mailbox is stale, so the first dispatcher run
   sends nothing. The sync job (`mail-sync`, every minute, also once at boot) catches up first.
2. **Stop rules run before any follow-up.** Every message that arrived meanwhile is ingested with its stop rules in
   one transaction: replies stop the lead (and, with "stop for company on reply", its colleagues), hard bounces and
   unsubscribes suppress the address. Only then does the mailbox count as fresh and may send again.
3. **Sends that were in flight are never resent.** A message left `SENDING` when the machine went down becomes
   `UNCERTAIN` once its lease (`SEND_LEASE_SEC`, default 600 s) expired. The recovery job (`send-recovery`, every 5 min,
   once at boot) searches the mailbox's Sent folder for its Message-ID: found → `SENT` (the sequence continues);
   not found twice, 15 min apart → `HELD`.
4. **The backlog is not burst-sent.** Overdue follow-ups go out under the normal rules: schedule window, gap between
   sends, account/campaign/workspace daily limits, and the lead's original mailbox. A backlog larger than a day's
   quota spreads over the next days. (After long pauses, the re-warm allowance arrives with P5-T06.)
5. **A mailbox whose sync keeps failing never sends.** In a campaign with "stop for company on reply", no mailbox of
   that campaign sends while any of its mailboxes is stale or needs attention, because a colleague's reply could be
   sitting unread in the failing one.

## Reconstructed from the mailboxes

The sync reads the provider's change history since the last sync. If that history expired during the downtime (Gmail
history ids, Graph delta tokens, an IMAP UIDVALIDITY change), it runs a full reconcile of INBOX and Sent from
`min(last successful sync − 2 days, now − 30 days)`. Either way it recovers:

- replies, including replies from another address of the lead or a colleague, and replies to a different mailbox of
  the workspace;
- auto-replies (out of office pushes the follow-ups to the return date, at most 90 days; an out-of-office without a
  readable date pauses them for 7 days);
- bounce notifications (DSNs): hard bounces suppress the address and stop the lead, soft and unknown ones are recorded;
- unsubscribe requests sent by email: a reply saying "unsubscribe", or the `mailto:` List-Unsubscribe message, which
  goes to the sending mailbox itself;
- messages sent from the mailbox by another client (shown in the inbox; they never count as campaign sends);
- deletions, where the provider reports them in its change history (an incremental sync only, see below).

A message the sync cannot store fails that run, and the mailbox waits (it does not send while stale). If the same
message fails three runs in a row, it is stored as a **placeholder**: sender, recipients, subject, date and threading
headers only, without body or attachments. Its stop rules still run (a reply still stops the lead) and the sync moves
on; the account's sync history (`SyncRun`) records `placeholder <code> msg=<id>`. The full message stays in the
provider mailbox.

## Not reconstructed

- **Opens and clicks** while the tracking endpoint (the app's URL or the custom tracking domain) was unreachable. A
  recipient who opened or clicked then is never recorded. Opens are estimates anyway.
- **One-click unsubscribes** (`List-Unsubscribe-Post`) and visits to the unsubscribe page while the web app was down.
  The recipient's mail client may show the request as done although it never arrived. The `mailto:` route is not
  affected (it lands in the synced sending mailbox).
- **Push notifications** (Gmail watch, Graph subscriptions) that arrive while the web app is down are lost; they only hurry a sync along, and the next poll (every `SYNC_POLL_SEC`) picks up the same changes.
- **Replies filtered to spam/junk.** The sync reads INBOX and Sent only, so a reply the provider put in spam does not
  stop the lead and is not shown in the inbox.
- **Deletions while the history was expired.** A full reconcile re-reads what is still there; it never marks a stored
  message as deleted remotely, so mail deleted in the provider during that downtime still shows in the inbox.
- **Mail older than the reconcile window.** After a downtime longer than the provider's history (and so a full
  reconcile), messages dated before `min(last successful sync − 2 days, now − 30 days)` are not re-read.

## What the operator sees

- **Accounts:** each account shows its sync state, last completed sync, lag and error count. During a full reconcile it
  shows the progress (mode, folder, messages fetched, since). After 5 failed runs in a row the account shows a sync
  error; an authentication failure sets it to "needs attention", and it does not send until reconnected.
- **Campaign "why not sending":** waiting for a sync, or "stop for company on reply" waiting for every mailbox.
- **Scheduled > Held:** sends whose outcome could not be confirmed. Check the mailbox's Sent folder first: "Release"
  tries again and can deliver a second copy. A reply to a held message proves it went out and marks it sent.
