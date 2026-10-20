import { runProviderContract } from "../src/contract/suite";
import { imapHarness } from "./imap-harness";

// CONDSTORE off is the worst case (many shared hosts); the provider saves the Sent copy itself.
runProviderContract(imapHarness("ImapSmtpProvider (in-process servers, APPEND to Sent)"));
// The server files the Sent copy itself (Gmail, Office 365): the provider must not APPEND.
runProviderContract(
  imapHarness("ImapSmtpProvider (in-process servers, server saves Sent)", { appendToSent: false }),
);
