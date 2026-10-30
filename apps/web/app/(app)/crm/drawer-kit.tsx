import { useEffect, useRef, useState } from "react";
import { call } from "../accounts/api-client";
import type { Opp } from "./types";

export const MAX = 999_999_999_999.99;

/** A modal <dialog> that reports its own close (Escape, Close button). `className` picks a sheet or a dialog. */
export function useDialog(onClose: () => void, className: string) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return {
    ref,
    props: { ref, onClose, className },
    close: () => ref.current?.close(),
  };
}

export const num = (v: string) => String(Number(v));
/** "Value must be 0 or more" and friends; empty string means valid. */
export const checkMoney = (label: string, v: string) =>
  v.trim() === "" || Number.isNaN(Number(v))
    ? `${label} must be a number`
    : Number(v) < 0
      ? `${label} must be 0 or more`
      : Number(v) > MAX
        ? `${label} is too large`
        : "";

export type Note = { id: string; kind: string; body: string; createdAt: string };
export type Task = { id: string; title: string; dueAt: string | null };
export type Step = { id: string; order: number; variants: { id: string; label: string }[] };

/** "From {campaign} · step {n} · variant {label} · {account}" */
export function useAttribution(opp: Opp) {
  const [attribution, setAttribution] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      const parts = [opp.campaign ? `From ${opp.campaign.name}` : "Created manually"];
      if (opp.campaign && opp.stepId) {
        const r = await call(`/api/v1/campaigns/${opp.campaign.id}/steps`, "GET");
        const subs = (r.json.subsequences ?? []) as { steps: Step[] }[];
        const all = [...((r.json.steps ?? []) as Step[]), ...subs.flatMap((s) => s.steps)];
        const step = all.find((s) => s.id === opp.stepId);
        if (step) parts.push(`step ${step.order}`);
        const v = step?.variants.find((x) => x.id === opp.variantId);
        if (v) parts.push(`variant ${v.label}`);
      }
      if (opp.accountId) {
        const r = await call(`/api/v1/accounts/${opp.accountId}`, "GET");
        if (typeof r.json.email === "string") parts.push(r.json.email);
      }
      if (live) setAttribution(parts.join(" · "));
    })();
    return () => {
      live = false;
    };
  }, [opp.campaign?.id, opp.stepId, opp.variantId, opp.accountId]);
  return attribution;
}
