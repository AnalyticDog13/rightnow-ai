import type { ReactNode } from "react";

/** B5.17 auth canvas: brand above a 400px column; a page marked `data-wide` (the onboarding wizard) widens it to 960. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-bg px-4 pt-[15vh] pb-8 md:justify-center md:py-8">
      <div className="flex w-full max-w-[400px] flex-col gap-6 has-[[data-wide]]:lg:max-w-[960px]">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-10 place-items-center rounded-sm bg-primary font-mono text-sm font-medium text-primary-foreground"
            >
              rn
            </span>
            <p className="text-[32px]/[40px] font-semibold tracking-[-0.015em]">rightnow</p>
          </div>
          <p className="text-[13px]/[18px] text-fg-muted">
            Self-hosted cold email. Your mailboxes, your data.
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
