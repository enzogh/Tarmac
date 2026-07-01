'use client';

import { ReactNode } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`card ${className}`}>
      {title && <h3 className="card-title">{title}</h3>}
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
}

export function StatCard({ label, value, icon, change, changeType }: StatCardProps) {
  return (
    <div className="card bg-panel-glow">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-50">{value}</p>
          {change && (
            <p
              className={`mt-2 text-xs font-medium ${
                changeType === 'up'
                  ? 'text-emerald-300'
                  : changeType === 'down'
                    ? 'text-rose-300'
                    : 'text-slate-400'
              }`}
            >
              {change}
            </p>
          )}
        </div>
        {icon && <span className="text-4xl opacity-70">{icon}</span>}
      </div>
    </div>
  );
}

interface BadgeProps {
  label: string;
  type?: 'success' | 'warning' | 'error' | 'info';
  icon?: string;
}

export function Badge({ label, type = 'info', icon }: BadgeProps) {
  const typeClasses = {
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-error',
    info: 'badge-info',
  };

  return (
    <span className={`badge ${typeClasses[type]}`}>
      {icon && <span>{icon}</span>}
      {label}
    </span>
  );
}

interface TableProps {
  headers: string[];
  rows: (string | number | ReactNode)[][];
}

export function Table({ headers, rows }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="transition-colors hover:bg-white/[0.03]">
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
