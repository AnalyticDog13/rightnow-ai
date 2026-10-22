import type { JobDef } from "../boss";
import { accountsAutoResumeJob } from "./accounts-auto-resume";
import { accountsAutofixJob } from "./accounts-autofix";
import { campaignDispatchJob } from "./campaign-dispatch";
import { campaignPlanJob } from "./campaign-plan";
import { dnsCheckJob } from "./dns-check";
import { leadImportJob } from "./lead-import";
import { mailSyncJob } from "./mail-sync";
import { sendRecoveryJob } from "./send-recovery";

// Later phases register their jobs here.
export const jobs: JobDef[] = [
  accountsAutoResumeJob,
  accountsAutofixJob,
  leadImportJob,
  campaignPlanJob,
  campaignDispatchJob,
  sendRecoveryJob,
  mailSyncJob,
  dnsCheckJob,
];
