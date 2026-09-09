import type { ReactNode } from "react";

import { DashboardHeader } from "./DashboardHeader";
import { Navigation, type PageId } from "./Navigation";

interface AppLayoutProps {
  activePage: PageId;
  children: ReactNode;
}

export function AppLayout({ activePage, children }: AppLayoutProps) {
  return (
    <div className="app-shell">
      <DashboardHeader />
      <Navigation activePage={activePage} />
      <main>{children}</main>
    </div>
  );
}
