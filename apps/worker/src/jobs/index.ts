import type { JobDef } from "../boss";
import { accountsAutoResumeJob } from "./accounts-auto-resume";
import { accountsAutofixJob } from "./accounts-autofix";

// Later phases register their jobs here.
export const jobs: JobDef[] = [accountsAutoResumeJob, accountsAutofixJob];
