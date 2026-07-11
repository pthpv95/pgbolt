import { useState } from "react";
import type { QueryTab } from "../types";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface Props {
  tabs: QueryTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseRight: (id: string) => void;
  onNew: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseLeft,
  onCloseRight,
  onNew,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  function menuItems(id: string): MenuItem[] {
    const idx = tabs.findIndex((t) => t.id === id);
    const items: MenuItem[] = [{ label: "Close", onClick: () => onClose(id) }];
    if (tabs.length > 1) {
      items.push({ label: "Close others", onClick: () => onCloseOthers(id) });
    }
    if (idx > 0) {
      items.push({ label: "Close tabs to the left", onClick: () => onCloseLeft(id) });
    }
    if (idx < tabs.length - 1) {
      items.push({ label: "Close tabs to the right", onClick: () => onCloseRight(id) });
    }
    return items;
  }

  return (
    <div className="tabbar">
      <div className="tabbar-scroll">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeTabId ? "active" : ""}`}
            onClick={() => onSelect(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id: t.id });
            }}
            title={t.title}
          >
            <span className="tab-title">{t.title}</span>
            <button
              className="tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="tab-add" title="New query tab (⌘T)" onClick={onNew}>
        +
      </button>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
