import { CAMPAIGN_STATUS, pillFor, StatusPill } from "../../../components/status-pill";

/** PS-UI-06 / B4.4: the campaign's display status as a pill; Active pulses only while the campaign is sending. */
export const StatusBadge = ({ status, sending }: { status: string; sending?: boolean }) => (
  <StatusPill {...pillFor(CAMPAIGN_STATUS, status)} pulse={status === "Active" && sending}>
    {status}
  </StatusPill>
);
