import type { JobDef } from "../boss";
import { accountsAutoResumeJob } from "./accounts-auto-resume";
import { accountsAutofixJob } from "./accounts-autofix";
import { campaignDispatchJob } from "./campaign-dispatch";
import { campaignPlanJob } from "./campaign-plan";
import { deliverabilityHealthJob } from "./deliverability-health";
import { dnsCheckJob } from "./dns-check";
import { eventDispatchJob } from "./event-dispatch";
import { leadImportJob } from "./lead-import";
import { leadVerifyJob } from "./lead-verify";
import { mailSyncJob } from "./mail-sync";
import { sendRecoveryJob } from "./send-recovery";
import { warmupTickJob } from "./warmup-tick";

// Later phases register their jobs here.
export const jobs: JobDef[] = [
  accountsAutoResumeJob,
  accountsAutofixJob,
  leadImportJob,
  leadVerifyJob,
  campaignPlanJob,
  campaignDispatchJob,
  sendRecoveryJob,
  mailSyncJob,
  dnsCheckJob,
  deliverabilityHealthJob,
  warmupTickJob,
  eventDispatchJob,
];
