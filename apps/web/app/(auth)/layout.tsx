import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <p className="text-center text-2xl font-semibold tracking-tight">RightNow</p>
      {children}
    </main>
  );
}
