"use client";

import { ReactNode, useEffect, useState } from 'react';

interface ModalProps {
  title: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}

export function Modal({ title, trigger, children }: ModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className="btn-primary">
        {trigger}
      </button>

      {isOpen && (
        <div className="modal-backdrop flex items-center justify-center p-4">
          <div className="modal-panel max-h-[min(90vh,48rem)] overflow-y-auto">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold tracking-tight text-slate-50">{title}</h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="btn-ghost h-9 w-9 rounded-full p-0"
                aria-label="Fermer"
              >
                ×
              </button>
            </div>
            {children(() => setIsOpen(false))}
          </div>
        </div>
      )}
    </>
  );
}
