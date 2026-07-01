'use client';

import { ReactNode, useState } from 'react';

interface ModalProps {
  title: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}

export function Modal({ title, trigger, children }: ModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="btn-primary">
        {trigger}
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 max-w-lg w-full mx-4 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>
            {children(() => setIsOpen(false))}
          </div>
        </div>
      )}
    </>
  );
}
