export type PageId = "draft" | "recommendations" | "roster" | "player-data" | "settings" | "readiness";

interface NavigationProps {
  activePage: PageId;
}

const links: ReadonlyArray<{ id: PageId; label: string }> = [
  { id: "draft", label: "Draft" },
  { id: "recommendations", label: "Recommendations" },
  { id: "roster", label: "My Roster" },
  { id: "player-data", label: "Player Data" },
  { id: "readiness", label: "Readiness" },
  { id: "settings", label: "Settings" },
];

export function Navigation({ activePage }: NavigationProps) {
  return (
    <nav className="navigation" aria-label="Primary navigation">
      {links.map((link) => (
        <a
          aria-current={activePage === link.id ? "page" : undefined}
          className={activePage === link.id ? "active" : undefined}
          href={`#/${link.id}`}
          key={link.id}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
