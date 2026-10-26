'use client';

import { createContext, ReactNode, useContext } from 'react';

type ReadOnlyState = { readOnly: boolean; area: string };

const ReadOnlyContext = createContext<ReadOnlyState>({ readOnly: false, area: '' });

/**
 * Set by the dashboard layout around a page the member may read but not
 * change. Actions marked `write` (Button, DropdownMenuItem, WriteLock)
 * read it to lock themselves instead of failing on click.
 */
export function ReadOnlyProvider({ readOnly, area, children }: ReadOnlyState & { children: ReactNode }) {
  return <ReadOnlyContext.Provider value={{ readOnly, area }}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): ReadOnlyState {
  return useContext(ReadOnlyContext);
}

export function readOnlyMessage(area: string): string {
  return `Lecture seule : votre rôle permet de consulter « ${area} » sans le modifier. Un administrateur peut vous donner l’accès en modification.`;
}
