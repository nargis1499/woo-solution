import type { ReactNode } from "react";
import { Footer } from "./footer";
import { Header } from "./header";

export function StoreShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
