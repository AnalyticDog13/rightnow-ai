import type { JobDef } from "../boss";
import { accountsAutoResumeJob } from "./accounts-auto-resume";
import { accountsAutofixJob } from "./accounts-autofix";
import { campaignDispatchJob } from "./campaign-dispatch";
import { campaignPlanJob } from "./campaign-plan";
import { leadImportJob } from "./lead-import";

// Later phases register their jobs here.
export const jobs: JobDef[] = [
  accountsAutoResumeJob,
  accountsAutofixJob,
  leadImportJob,
  campaignPlanJob,
  campaignDispatchJob,
];
