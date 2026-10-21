// shortcut: static list, swap for a maintained package if misses show up
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  ...["mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org"],
  ...["guerrillamail.biz", "guerrillamailblock.com", "sharklasers.com", "grr.la"],
  ...["10minutemail.com", "10minutemail.net", "20minutemail.com", "temp-mail.org"],
  ...["tempmail.com", "temp-mail.io", "tempmail.net", "tempmailo.com", "tempail.com"],
  ...["throwawaymail.com", "trashmail.com", "trashmail.net", "trashmail.de", "trash-mail.com"],
  ...["yopmail.com", "yopmail.net", "yopmail.fr", "getnada.com", "nada.email"],
  ...["dispostable.com", "maildrop.cc", "mailnesia.com", "mailcatch.com", "mintemail.com"],
  ...["fakeinbox.com", "fakemail.net", "spamgourmet.com", "spambox.us", "spam4.me"],
  ...["mytemp.email", "moakt.com", "emailondeck.com", "burnermail.io", "mohmal.com"],
  ...["discard.email", "discardmail.com", "mailforspam.com", "mailtemp.info", "tmpmail.org"],
  ...["tmpmail.net", "inboxkitten.com", "harakirimail.com", "jetable.org", "getairmail.com"],
  ...["33mail.com", "anonbox.net", "dropmail.me", "emailfake.com", "email-fake.com"],
  ...["tempinbox.com", "tempr.email", "temporaryemail.net", "mailsac.com", "owlymail.com"],
]);
